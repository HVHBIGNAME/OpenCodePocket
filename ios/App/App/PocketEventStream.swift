import Foundation
import Network

final class PocketEventStream: NSObject, URLSessionDataDelegate {
    private let address: URL
    private let authorization: String
    private let onEvent: (String) -> Void
    private let onState: (Bool) -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var lines: [String] = []
    private var frameID: String?
    private var dataSize = 0
    private var skipLF = false
    private var lastID = ""
    private var seen: [String] = []
    private var retry: DispatchWorkItem?
    private var failures = 0
    private var stopped = false
    private var paused = false
    private var connected = false
    private var lastActivity = Date.distantPast
    private let network = NWPathMonitor()
    private var networkPath: String?

    init(url: URL, authorization: String, onEvent: @escaping (String) -> Void, onState: @escaping (Bool) -> Void) {
        self.address = url
        self.authorization = authorization
        self.onEvent = onEvent
        self.onState = onState
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 65
        config.timeoutIntervalForResource = 86400
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        network.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            let signature = "\(available):\(path.usesInterfaceType(.wifi)):\(path.usesInterfaceType(.cellular)):\(path.usesInterfaceType(.wiredEthernet))"
            DispatchQueue.main.async {
                guard let self = self, !self.stopped, !self.paused else { return }
                let previous = self.networkPath
                self.networkPath = signature
                if !available {
                    self.retry?.cancel()
                    let old = self.task
                    self.task = nil
                    old?.cancel()
                    self.connected = false
                    self.onState(false)
                } else if previous != nil && previous != signature {
                    self.resume(force: true)
                }
            }
        }
        network.start(queue: DispatchQueue(label: "occ.network"))
    }

    func start() {
        guard !stopped, !paused, task == nil else { return }
        var request = URLRequest(url: address)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if !authorization.isEmpty { request.setValue(authorization, forHTTPHeaderField: "Authorization") }
        if !lastID.isEmpty { request.setValue(lastID, forHTTPHeaderField: "Last-Event-ID") }
        buffer = Data()
        lines = []
        frameID = nil
        dataSize = 0
        skipLF = false
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func resume(force: Bool = false) {
        guard !stopped else { return }
        paused = false
        if !force, task != nil, connected, Date().timeIntervalSince(lastActivity) < 25 {
            onState(true)
            return
        }
        retry?.cancel()
        let old = task
        task = nil
        old?.cancel()
        failures = 0
        start()
    }

    func stop() {
        stopped = true
        network.cancel()
        retry?.cancel()
        task?.cancel()
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    func pause() {
        paused = true
        retry?.cancel()
        retry = nil
        let previous = task
        task = nil
        previous?.cancel()
        connected = false
        buffer = Data()
        lines = []
        dataSize = 0
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !stopped, dataTask == task else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            if (response as? HTTPURLResponse)?.statusCode == 401 {
                onState(false)
                onEvent("{\"type\":\"occ.unauthorized\",\"properties\":{}}")
                stop()
            }
            onState(false)
            completionHandler(.cancel)
            return
        }
        guard (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.lowercased().contains("text/event-stream") == true else {
            onState(false)
            completionHandler(.cancel)
            return
        }
        failures = 0
        connected = true
        lastActivity = Date()
        onState(true)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !stopped, dataTask == task else { return }
        lastActivity = Date()
        buffer.append(data)
        if buffer.count + dataSize > 8 * 1024 * 1024 { dataTask.cancel(); return }
        while !buffer.isEmpty {
            if skipLF {
                if buffer.first == 10 { buffer.removeFirst() }
                skipLF = false
            }
            guard let newline = buffer.firstIndex(where: { $0 == 10 || $0 == 13 }) else { break }
            let bytes = buffer[..<newline]
            guard let line = String(data: bytes, encoding: .utf8) else { dataTask.cancel(); return }
            skipLF = buffer[newline] == 13
            buffer.removeSubrange(...newline)
            if line.isEmpty {
                if let id = frameID { lastID = id }
                if !lines.isEmpty {
                    let id = frameID ?? ""
                    if id.isEmpty || !seen.contains(id) {
                        onEvent(lines.joined(separator: "\n"))
                        if !id.isEmpty { seen.append(id) }
                    }
                    if seen.count > 512 { seen.removeFirst(seen.count - 512) }
                }
                lines = []
                dataSize = 0
                frameID = nil
            } else if line.hasPrefix("data:") {
                var value = String(line.dropFirst(5))
                if value.hasPrefix(" ") { value.removeFirst() }
                lines.append(value)
                dataSize += value.utf8.count + 1
                if dataSize > 8 * 1024 * 1024 { dataTask.cancel(); return }
            } else if line == "id" || line.hasPrefix("id:") {
                var value = line == "id" ? "" : String(line.dropFirst(3))
                if value.hasPrefix(" ") { value.removeFirst() }
                if !value.contains("\0") { frameID = value }
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !stopped, task == self.task else { return }
        self.task = nil
        connected = false
        onState(false)
        let delay = min(30.0, pow(2.0, Double(min(failures, 5))))
        failures += 1
        let work = DispatchWorkItem { [weak self] in self?.start() }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    func urlSession(_ session: URLSession, taskIsWaitingForConnectivity task: URLSessionTask) {
        guard !stopped, task == self.task else { return }
        connected = false
        onState(false)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
