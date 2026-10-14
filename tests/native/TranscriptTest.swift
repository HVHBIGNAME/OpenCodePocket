import Foundation

@main
struct TranscriptTest {
    static func words(_ text: String, start: Double) -> [PocketSpeechWord] {
        var offset = 0
        return text.split(separator: " ").enumerated().map { index, word in
            let length = (String(word) as NSString).length
            let value = PocketSpeechWord(start: start + Double(index), end: start + Double(index) + 0.8, range: NSRange(location: offset, length: length))
            offset += length + 1
            return value
        }
    }

    static func main() {
        var speech = PocketTranscript()
        speech.update(0, text: "Добрый ден", words: words("Добрый ден", start: 0))
        speech.update(0, text: "Добрый день.", words: words("Добрый день.", start: 0))
        precondition(speech.text == "Добрый день.", "Partial correction duplicated the phrase")
        speech.update(0, text: "После паузы продолжаю.", words: words("После паузы продолжаю.", start: 4))
        precondition(speech.text == "Добрый день. После паузы продолжаю.", "A pause removed earlier text")

        var sliding = PocketTranscript()
        sliding.update(0, text: "one two three", words: words("one two three", start: 0))
        sliding.update(0, text: "two THREE four", words: words("two THREE four", start: 1))
        precondition(sliding.text == "one two THREE four", "Sliding window lost or duplicated its prefix")
        sliding.update(0, text: "one two THREE four", words: words("one two THREE four", start: 0))
        precondition(sliding.text == "one two THREE four", "A complete final result duplicated the committed prefix")

        speech.update(1, text: "Новая задача.", words: words("Новая задача.", start: 0))
        speech.update(0, text: "Добрый день. После паузы продолжаю!", words: words("Добрый день. После паузы продолжаю!", start: 0))
        precondition(speech.text == "Добрый день. После паузы продолжаю! Новая задача.", "Late final replaced a newer request")
        speech.update(1, text: "", words: [])
        precondition(speech.text.hasSuffix("Новая задача."), "Empty final erased partial text")

        var long = PocketTranscript()
        let expected = (0..<120).map { "Фрагмент \($0): " + String(repeating: "длинный текст 🎙️ ", count: 40) }
        for (index, text) in expected.enumerated() { long.update(index, text: text, words: words(text, start: 0)) }
        precondition(long.text == expected.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: " "), "Long dictation was truncated")
        print("PASS iPhone transcript: corrections, pauses, sliding windows, late finals, empty finals and 120 long chunks")
    }
}
