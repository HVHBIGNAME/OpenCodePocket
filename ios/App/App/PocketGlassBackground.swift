import UIKit
import WebKit

final class PocketGlassBackground: UIView {
    private let gradient = CAGradientLayer()
    private var materials: [String: UIVisualEffectView] = [:]
    private weak var webView: WKWebView?
    private var savedOpaque = true
    private var savedBackground: UIColor?
    private var savedScrollBackground: UIColor?

    static var supported: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), UIDevice.current.userInterfaceIdiom == .phone { return true }
        #endif
        return false
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        clipsToBounds = true
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        layer.addSublayer(gradient)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        CATransaction.commit()
    }

    func configure(webView: WKWebView, enabled: Bool, dark: Bool) -> Bool {
        guard enabled, Self.supported,
              !UIAccessibility.isReduceTransparencyEnabled,
              !ProcessInfo.processInfo.isLowPowerModeEnabled,
              let parent = webView.superview else {
            disable()
            return false
        }
        if superview == nil {
            self.webView = webView
            savedOpaque = webView.isOpaque
            savedBackground = webView.backgroundColor
            savedScrollBackground = webView.scrollView.backgroundColor
            parent.insertSubview(self, belowSubview: webView)
        }
        frame = webView.frame
        overrideUserInterfaceStyle = dark ? .dark : .light
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        let colors: [UIColor] = dark
            ? [UIColor(red: 0.06, green: 0.11, blue: 0.18, alpha: 1), UIColor(red: 0.14, green: 0.22, blue: 0.34, alpha: 1), UIColor(red: 0.13, green: 0.12, blue: 0.25, alpha: 1)]
            : [UIColor(red: 0.90, green: 0.95, blue: 1, alpha: 1), UIColor(red: 0.80, green: 0.88, blue: 0.98, alpha: 1), UIColor(red: 0.93, green: 0.88, blue: 0.98, alpha: 1)]
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.colors = colors.map(\.cgColor)
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        CATransaction.commit()
        return true
    }

    func update(regions: [[String: Any]], viewportWidth: Double) {
        guard superview != nil, let webView = webView, viewportWidth.isFinite, viewportWidth > 0 else { return }
        frame = webView.frame
        let scale = bounds.width / CGFloat(viewportWidth)
        var visible = Set<String>()
        for region in regions.prefix(4) {
            guard let id = region["id"] as? String,
                  ["navigation", "composer", "connection"].contains(id),
                  let x = region["x"] as? Double, let y = region["y"] as? Double,
                  let width = region["width"] as? Double, let height = region["height"] as? Double,
                  [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { continue }
            let rect = CGRect(x: CGFloat(x) * scale, y: CGFloat(y) * scale,
                              width: min(CGFloat(width) * scale, bounds.width),
                              height: min(CGFloat(height) * scale, bounds.height))
            guard rect.intersects(bounds) else { continue }
            let material: UIVisualEffectView
            if let existing = materials[id] { material = existing }
            else {
                #if compiler(>=6.2)
                if #available(iOS 26.0, *) {
                    let effect = UIGlassEffect(style: .regular)
                    effect.isInteractive = false
                    material = UIVisualEffectView(effect: effect)
                } else { continue }
                #else
                continue
                #endif
                material.isUserInteractionEnabled = false
                material.clipsToBounds = true
                material.layer.cornerCurve = .continuous
                materials[id] = material
                addSubview(material)
            }
            material.frame = rect
            let radius = (region["radius"] as? Double) ?? 24
            material.layer.cornerRadius = radius.isFinite ? min(CGFloat(max(0, radius)) * scale, rect.height / 2) : 24
            visible.insert(id)
        }
        for id in Array(materials.keys) where !visible.contains(id) {
            materials.removeValue(forKey: id)?.removeFromSuperview()
        }
    }

    func disable() {
        for material in materials.values { material.removeFromSuperview() }
        materials.removeAll()
        if let webView = webView {
            webView.isOpaque = savedOpaque
            webView.backgroundColor = savedBackground
            webView.scrollView.backgroundColor = savedScrollBackground
        }
        webView = nil
        removeFromSuperview()
    }
}
