import UIKit
import WebKit

final class PocketGlassBackground: UIView {
    private var controls: [String: UIButton] = [:]
    private weak var webView: WKWebView?
    var onAction: ((String) -> Void)?

    static var supported: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), UIDevice.current.userInterfaceIdiom == .phone { return true }
        #endif
        return false
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        clipsToBounds = true
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, alpha > 0, isUserInteractionEnabled else { return nil }
        for button in controls.values where !button.isHidden && button.isEnabled {
            let local = button.convert(point, from: self)
            if let hit = button.hitTest(local, with: event) { return hit }
        }
        return nil
    }

    func configure(webView: WKWebView, enabled: Bool, dark: Bool) -> Bool {
        guard enabled, Self.supported,
              !UIAccessibility.isReduceTransparencyEnabled,
              !ProcessInfo.processInfo.isLowPowerModeEnabled,
              let parent = webView.superview else {
            disable()
            return false
        }
        self.webView = webView
        if superview !== parent { parent.insertSubview(self, aboveSubview: webView) }
        frame = webView.frame
        overrideUserInterfaceStyle = dark ? .dark : .light
        return true
    }

    func update(regions: [[String: Any]], viewportWidth: Double) -> [String] {
        guard superview != nil, let webView = webView, viewportWidth.isFinite, viewportWidth > 0 else { return [] }
        frame = webView.frame
        let scale = bounds.width / CGFloat(viewportWidth)
        var visible = Set<String>()
        for region in regions.prefix(2) {
            guard let id = region["id"] as? String, ["connection", "model"].contains(id),
                  let title = region["title"] as? String, let label = region["label"] as? String,
                  let x = region["x"] as? Double, let y = region["y"] as? Double,
                  let width = region["width"] as? Double, let height = region["height"] as? Double,
                  [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { continue }
            let rect = CGRect(x: CGFloat(x) * scale, y: CGFloat(y) * scale,
                              width: CGFloat(width) * scale, height: CGFloat(height) * scale)
            guard bounds.insetBy(dx: -1, dy: -1).contains(rect) else { continue }
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                let button: UIButton
                if let existing = controls[id] { button = existing }
                else {
                    button = UIButton(type: .system)
                    button.addAction(UIAction { [weak self] _ in self?.onAction?(id) }, for: .touchUpInside)
                    controls[id] = button
                    addSubview(button)
                }
                var configuration = UIButton.Configuration.glass()
                configuration.title = String(title.prefix(200))
                configuration.image = UIImage(systemName: "chevron.down")
                configuration.imagePlacement = .trailing
                configuration.imagePadding = 6
                configuration.cornerStyle = .capsule
                configuration.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 10)
                let size = (region["fontSize"] as? Double) ?? 13
                let fontSize = size.isFinite ? CGFloat(min(22, max(10, size))) * scale : 13
                configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                    var result = attributes
                    result.font = UIFont.systemFont(ofSize: fontSize, weight: .medium)
                    return result
                }
                configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 11, weight: .medium)
                if let color = region["foreground"] as? [Double], color.count == 3, color.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) {
                    configuration.baseForegroundColor = UIColor(red: CGFloat(color[0]), green: CGFloat(color[1]), blue: CGFloat(color[2]), alpha: 1)
                }
                button.configuration = configuration
                button.titleLabel?.lineBreakMode = .byTruncatingTail
                button.accessibilityLabel = String(label.prefix(300))
                button.accessibilityValue = id == "model" ? String(title.prefix(200)) : nil
                button.isEnabled = !(region["disabled"] as? Bool ?? false)
                button.frame = rect
                visible.insert(id)
            }
            #endif
        }
        for id in Array(controls.keys) where !visible.contains(id) { controls.removeValue(forKey: id)?.removeFromSuperview() }
        return Array(visible)
    }

    func disable() {
        for control in controls.values { control.removeFromSuperview() }
        controls.removeAll()
        webView = nil
        removeFromSuperview()
    }
}
