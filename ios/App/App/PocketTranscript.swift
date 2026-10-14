import Foundation

struct PocketSpeechWord {
    let start: TimeInterval
    let end: TimeInterval
    let range: NSRange
}

// Each recognition request owns a window. Late final results can revise that
// window without replacing text already collected by a later request.
struct PocketTranscript {
    private struct Window {
        var text = ""
        var words: [PocketSpeechWord] = []
    }
    private var windows: [Int: [Window]] = [:]

    var text: String {
        windows.keys.sorted().flatMap { windows[$0] ?? [] }.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.joined(separator: " ")
    }

    mutating func update(_ id: Int, text: String, words: [PocketSpeechWord]) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let previous = windows[id] ?? []
        guard let start = words.first?.start, let end = words.last?.end else {
            windows[id] = previous.isEmpty ? [Window(text: text)] : Array(previous.dropLast()) + [Window(text: text)]
            return
        }
        let prefix: [Window] = previous.compactMap { window in
            guard let first = window.words.first?.start, first < start - 0.1 else { return nil }
            let retained = window.words.filter { $0.end <= start + 0.03 }
            guard let last = retained.last else { return nil }
            if retained.count == window.words.count { return window }
            let bound = NSMaxRange(last.range)
            guard bound <= (window.text as NSString).length else { return nil }
            return Window(text: (window.text as NSString).substring(to: bound), words: retained)
        }
        let suffix = previous.filter { ($0.words.first?.start ?? 0) > end + 0.1 }
        windows[id] = prefix + [Window(text: text, words: words)] + suffix
    }
}
