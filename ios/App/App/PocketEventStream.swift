import Foundation

final class PocketEventStream: NSObject, URLSessionDataDelegate {
    private let address: URL
    private let authorization: String
    private let onEvent: (String) -> Void
    private let onState: (Bool) -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var lines: [String] = []
    private var frameID = ""
    private var lastID = ""
    private var seen: [String] = []
    private var retry: DispatchWorkItem?
    private var failures = 0
    private var stopped = false

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
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }

    func start() {
        guard !stopped else { return }
        var request = URLRequest(url: address)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if !authorization.isEmpty { request.setValue(authorization, forHTTPHeaderField: "Authorization") }
        if !lastID.isEmpty { request.setValue(lastID, forHTTPHeaderField: "Last-Event-ID") }
        buffer = Data()
        lines = []
        frameID = ""
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func resume() {
        guard !stopped else { return }
        retry?.cancel()
        let old = task
        task = nil
        old?.cancel()
        failures = 0
        start()
    }

    func stop() {
        stopped = true
        retry?.cancel()
        task?.cancel()
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !stopped, dataTask == task else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            if (response as? HTTPURLResponse)?.statusCode == 401 {
                onEvent("{\"type\":\"occ.unauthorized\",\"properties\":{}}")
                stopped = true
            }
            onState(false)
            completionHandler(.cancel)
            return
        }
        failures = 0
        onState(true)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !stopped, dataTask == task else { return }
        buffer.append(data)
        if buffer.count > 8 * 1024 * 1024 { dataTask.cancel(); return }
        while let newline = buffer.firstIndex(of: 10) {
            let bytes = buffer[..<newline]
            let line = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: CharacterSet(charactersIn: "\r")) ?? ""
            buffer.removeSubrange(...newline)
            if line.isEmpty {
                if !lines.isEmpty {
                    if frameID.isEmpty || !seen.contains(frameID) {
                        onEvent(lines.joined(separator: "\n"))
                        if !frameID.isEmpty { seen.append(frameID) }
                    }
                    if !frameID.isEmpty { lastID = frameID }
                    if seen.count > 512 { seen.removeFirst(seen.count - 512) }
                }
                lines = []
                frameID = ""
            } else if line.hasPrefix("data:") {
                var value = String(line.dropFirst(5))
                if value.hasPrefix(" ") { value.removeFirst() }
                lines.append(value)
            } else if line.hasPrefix("id:") {
                let value = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                if !value.contains("\0") { frameID = value }
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !stopped, task == self.task else { return }
        onState(false)
        let delay = min(30.0, pow(2.0, Double(min(failures, 5))))
        failures += 1
        let work = DispatchWorkItem { [weak self] in self?.start() }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
