import Foundation
import Capacitor
import UserNotifications
import UIKit

final class PocketBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PocketNativePlugin())
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceHorizontal = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.keyboardDismissMode = .interactive
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

enum PocketNotificationRouter { static var pendingSessionID: String? }

@objc(PocketNativePlugin)
public class PocketNativePlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "PocketNativePlugin"
    public let jsName = "PocketNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readSecure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSecure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSecure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise)
    ]
    private var stream: PocketEventStream?
    private var speech: PocketSpeech?
    private var pushCall: CAPPluginCall?
    private var pushTimeout: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        speech = PocketSpeech { [weak self] event in self?.notifyListeners("speech", data: event) }
        UNUserNotificationCenter.current().delegate = self
        observers.append(NotificationCenter.default.addObserver(forName: Notification.Name("occPushRegistered"), object: nil, queue: .main) { [weak self] notification in
            guard let self = self, let token = notification.object as? String else { return }
            self.pushTimeout?.cancel()
            self.pushCall?.resolve(["token": token])
            self.pushCall = nil
        })
        observers.append(NotificationCenter.default.addObserver(forName: Notification.Name("occPushFailed"), object: nil, queue: .main) { [weak self] notification in
            self?.pushTimeout?.cancel()
            self?.pushCall?.reject("APNs: \((notification.object as? Error)?.localizedDescription ?? "нет ответа")")
            self?.pushCall = nil
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.stream?.resume() })
        if let id = PocketNotificationRouter.pendingSessionID {
            notifyListeners("notificationTap", data: ["sessionID": id], retainUntilConsumed: true)
            PocketNotificationRouter.pendingSessionID = nil
        }
    }

    @objc func readSecure(_ call: CAPPluginCall) {
        do {
            if let value = try PocketKeychain.read(call.getString("key") ?? "") { call.resolve(["value": value]) }
            else { call.resolve([:]) }
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func writeSecure(_ call: CAPPluginCall) {
        do {
            try PocketKeychain.write(call.getString("key") ?? "", call.getString("value") ?? "")
            call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func removeSecure(_ call: CAPPluginCall) {
        do {
            try PocketKeychain.remove(call.getString("key") ?? "")
            call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func startEvents(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let text = call.getString("url"), let url = URL(string: text), ["https", "http"].contains(url.scheme ?? "") else { call.reject("Invalid event URL"); return }
            self.stream?.stop()
            self.stream = PocketEventStream(url: url, authorization: call.getString("authorization") ?? "", onEvent: { [weak self] data in
                self?.notifyListeners("serverEvent", data: ["data": data])
            }, onState: { [weak self] connected in
                self?.notifyListeners("connection", data: ["state": connected ? "connected" : "reconnecting"])
            })
            self.stream?.start()
            call.resolve()
        }
    }

    @objc func stopEvents(_ call: CAPPluginCall) { DispatchQueue.main.async { self.stream?.stop(); self.stream = nil; call.resolve() } }
    @objc func startSpeech(_ call: CAPPluginCall) { DispatchQueue.main.async { self.speech?.start(call) } }
    @objc func stopSpeech(_ call: CAPPluginCall) { DispatchQueue.main.async { self.speech?.stop(); call.resolve() } }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error { call.reject(error.localizedDescription) }
            else { call.resolve(["granted": granted]) }
        }
    }

    @objc func registerPush(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pushCall == nil else { call.reject("Регистрация APNs уже выполняется"); return }
            self.pushCall = call
            let timeout = DispatchWorkItem { [weak self] in
                self?.pushCall?.reject("APNs не ответил. Проверьте подпись приложения и Push Notifications entitlement.")
                self?.pushCall = nil
            }
            self.pushTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    @objc func notificationStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: status = "granted"
            case .denied: status = "denied"
            default: status = "prompt"
            }
            call.resolve(["status": status])
        }
    }

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Настройки недоступны"); return }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("Не удалось открыть настройки") }
            }
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["sessionID"] as? String ?? ""
        notifyListeners("notificationTap", data: ["sessionID": id], retainUntilConsumed: true)
        completionHandler()
    }

    deinit {
        stream?.stop()
        pushTimeout?.cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }
}
