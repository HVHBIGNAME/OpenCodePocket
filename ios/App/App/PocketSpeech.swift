import AVFoundation
import Speech
import Capacitor

final class PocketSpeech {
    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var starting = false
    private var generation = UUID()
    private let emit: ([String: Any]) -> Void

    init(emit: @escaping ([String: Any]) -> Void) { self.emit = emit }

    func start(_ call: CAPPluginCall) {
        guard !starting, task == nil else { call.reject("Диктовка уже запущена. Подождите завершения."); return }
        starting = true
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self else { call.reject("Диктовка закрыта"); return }
                guard status == .authorized else {
                    self.starting = false
                    call.reject("Разрешите распознавание речи для OCC в настройках iOS.")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
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
        let offline = call.getBool("offline") ?? true
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            call.reject("Системное распознавание этого языка сейчас недоступно."); return
        }
        if offline && !recognizer.supportsOnDeviceRecognition {
            call.reject("Офлайн-распознавание этого языка недоступно. Установите языковой пакет или отключите «Только на устройстве» в OCC."); return
        }
        self.recognizer = recognizer
        let current = UUID()
        generation = current
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = offline
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "OCC", code: 1, userInfo: [NSLocalizedDescriptionKey: "Микрофон сейчас недоступен."]) }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self = self, self.generation == current else { return }
                    if let result = result {
                        self.emit(["text": result.bestTranscription.formattedString, "final": result.isFinal])
                        if result.isFinal { self.cancel() }
                    } else if let error = error {
                        self.emit(["error": "Распознавание: \(error.localizedDescription)", "final": true])
                        self.cancel()
                    }
                }
            }
            call.resolve()
        } catch {
            cancel()
            call.reject("Не удалось начать диктовку: \(error.localizedDescription)")
        }
    }

    private func stopAudio() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        do { try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        catch { NSLog("OCC audio session could not deactivate: %@", error.localizedDescription) }
    }

    func stop() {
        guard task != nil else { return }
        request?.endAudio()
        stopAudio()
        let current = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, self.generation == current else { return }
            self.emit(["final": true])
            self.cancel()
        }
    }

    func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
        request = nil
        recognizer = nil
        stopAudio()
    }
}
