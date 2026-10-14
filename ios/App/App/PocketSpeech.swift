import AVFoundation
import Speech
import Capacitor
import UIKit

private final class PocketAudioSink {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func replace(_ next: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        let previous = request
        request = next
        previous?.endAudio()
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        request?.append(buffer)
        lock.unlock()
    }
}

final class PocketSpeech {
    private let engine = AVAudioEngine()
    private let sink = PocketAudioSink()
    private var recognizer: SFSpeechRecognizer?
    private var tasks: [Int: SFSpeechRecognitionTask] = [:]
    private var transcript = PocketTranscript()
    private var tapInstalled = false
    private var audioActive = false
    private var starting = false
    private var listening = false
    private var finishing = false
    private var offline = true
    private var generation = UUID()
    private var sessionID = ""
    private var current = -1
    private var rollover: DispatchWorkItem?
    private var finishTimeout: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []
    private let emit: ([String: Any]) -> Void

    init(emit: @escaping ([String: Any]) -> Void) {
        self.emit = emit
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue { self?.stop() }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.stop() })
    }

    func start(_ call: CAPPluginCall) {
        guard !starting, !listening, !finishing else { call.reject("Диктовка уже запущена. Подождите завершения."); return }
        starting = true
        let token = UUID()
        generation = token
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self, self.generation == token else { call.reject("Диктовка отменена"); return }
                guard status == .authorized else {
                    self.starting = false
                    call.reject("Разрешите распознавание речи для OCC в настройках iOS.")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard self.generation == token else { call.reject("Диктовка отменена"); return }
                        self.starting = false
                        guard granted else { call.reject("Разрешите доступ к микрофону для OCC."); return }
                        self.begin(call)
                    }
                }
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? "ru-RU"
        offline = call.getBool("offline") ?? true
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            call.reject("Системное распознавание этого языка сейчас недоступно."); return
        }
        if offline && !recognizer.supportsOnDeviceRecognition {
            call.reject("Офлайн-распознавание этого языка недоступно. Установите языковой пакет или отключите «Только на устройстве» в OCC."); return
        }
        self.recognizer = recognizer
        sessionID = call.getString("id") ?? UUID().uuidString
        transcript = PocketTranscript()
        current = -1
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
            audioActive = true
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "OCC", code: 1, userInfo: [NSLocalizedDescriptionKey: "Микрофон сейчас недоступен."]) }
            let sink = self.sink
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in sink.append(buffer) }
            tapInstalled = true
            listening = true
            startRequest()
            engine.prepare()
            try engine.start()
            publish()
            call.resolve()
        } catch {
            cancel()
            call.reject("Не удалось начать диктовку: \(error.localizedDescription)")
        }
    }

    private func startRequest() {
        guard listening, let recognizer = recognizer else { return }
        rollover?.cancel()
        let previous = current
        current += 1
        let id = current
        let token = generation
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = offline
        request.taskHint = .dictation
        sink.replace(request)
        tasks[id] = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.receive(id, token: token, result: result, error: error) }
        }
        // Audio capture stays running while the previous request drains its final result.
        tasks[previous]?.finish()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, self.generation == token else { return }
            self.tasks.removeValue(forKey: previous)?.cancel()
            self.finishIfDrained()
        }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.generation == token, self.current == id else { return }
            self.startRequest()
        }
        rollover = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 50, execute: work)
    }

    private func receive(_ id: Int, token: UUID, result: SFSpeechRecognitionResult?, error: Error?) {
        guard generation == token, tasks[id] != nil else { return }
        if let result = result {
            let value = result.bestTranscription
            transcript.update(id, text: value.formattedString, words: value.segments.map {
                PocketSpeechWord(start: $0.timestamp, end: $0.timestamp + $0.duration, range: $0.substringRange)
            })
            publish()
        }
        if result?.isFinal == true || error != nil {
            tasks.removeValue(forKey: id)
            if listening && id == current {
                let nativeError = error as NSError?
                // Silence ends a recognition request, not the user's recording session.
                if error == nil || nativeError?.code == 1110 || nativeError?.code == 203 { startRequest() }
                else { finish(error: "Распознавание остановлено: \(error!.localizedDescription)") }
            } else { finishIfDrained() }
        } else if result?.speechRecognitionMetadata != nil && listening && id == current {
            // iOS can reset formattedString after a settled utterance while isFinal is false.
            startRequest()
        }
    }

    private func publish(final: Bool = false, error: String? = nil) {
        var event: [String: Any] = ["id": sessionID, "text": transcript.text, "final": final, "state": final ? "idle" : finishing ? "finishing" : "listening"]
        if let error = error { event["error"] = error }
        emit(event)
    }

    private func stopAudio() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        sink.replace(nil)
        if audioActive {
            do { try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
            catch { NSLog("OCC audio session could not deactivate: %@", error.localizedDescription) }
            audioActive = false
        }
    }

    func stop() {
        if starting { cancel(); return }
        guard listening else { return }
        listening = false
        finishing = true
        rollover?.cancel()
        stopAudio()
        for task in tasks.values { task.finish() }
        publish()
        let token = generation
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.generation == token else { return }
            self.finish()
        }
        finishTimeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
        finishIfDrained()
    }

    private func finishIfDrained() { if finishing && tasks.isEmpty { finish() } }
    private func finish(error: String? = nil) {
        publish(final: true, error: error)
        cancel()
    }

    func cancel() {
        generation = UUID()
        starting = false
        listening = false
        finishing = false
        rollover?.cancel()
        finishTimeout?.cancel()
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
        recognizer = nil
        if audioActive || tapInstalled || engine.isRunning { stopAudio() } else { sink.replace(nil) }
    }

    deinit {
        cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }
}
