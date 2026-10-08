import Foundation
import MetricKit

final class PocketMetrics: NSObject, MXMetricManagerSubscriber {
    static let shared = PocketMetrics()

    func didReceive(_ payloads: [MXMetricPayload]) {}

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        do {
            if let text = try PocketKeychain.read("occ.preferences"), let data = text.data(using: .utf8),
               let prefs = try JSONSerialization.jsonObject(with: data) as? [String: Any], prefs["diagnostics"] as? Bool == false { return }
            var reports: [[String: Any]] = []
            if let text = try PocketKeychain.read("occ.nativeReports"), let data = text.data(using: .utf8) {
                reports = (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
            }
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
            let os = ProcessInfo.processInfo.operatingSystemVersion
            for payload in payloads {
                for crash in payload.crashDiagnostics ?? [] {
                    reports.append(["schema": 1, "id": UUID().uuidString.lowercased(), "timestamp": Int(payload.timeStampEnd.timeIntervalSince1970 * 1000),
                                    "version": version, "platform": "ios", "kind": "native-crash", "severity": "fatal", "name": "NativeCrash",
                                    "operation": "unknown", "screen": "unknown", "frames": frames(crash.callStackTree),
                                    "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"])
                }
            }
            if reports.count > 20 { reports = Array(reports.suffix(20)) }
            let data = try JSONSerialization.data(withJSONObject: reports)
            if let text = String(data: data, encoding: .utf8) { try PocketKeychain.write("occ.nativeReports", text) }
        } catch { NSLog("OCC: native diagnostic queue unavailable") }
    }

    private func frames(_ tree: MXCallStackTree) -> [String] {
        let data = tree.jsonRepresentation()
        guard data.count < 1024 * 1024, let value = try? JSONSerialization.jsonObject(with: data) else { return ["MetricKit"] }
        var output: [String] = []
        var visited = 0
        func walk(_ value: Any) {
            guard output.count < 12, visited < 600 else { return }
            visited += 1
            if let object = value as? [String: Any] {
                if let binary = object["binaryName"] as? String, let offset = object["offsetIntoBinaryTextSegment"] as? NSNumber {
                    let clean = String(binary.filter { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) }.prefix(60))
                    output.append("\(clean)+\(offset.stringValue)")
                }
                for child in object.values { walk(child) }
            } else if let array = value as? [Any] { for child in array { walk(child) } }
        }
        walk(value)
        return output.isEmpty ? ["MetricKit"] : output
    }
}
