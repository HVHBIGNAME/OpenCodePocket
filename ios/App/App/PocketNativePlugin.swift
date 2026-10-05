import Foundation
import Capacitor
import UserNotifications
import UIKit
import Security

final class PocketBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(PocketNativePlugin()) }
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
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise)
    ]
    private var stream: PocketEventStream?
    private var speech: PocketSpeech?
    private var notifications = false
    private var pushCall: CAPPluginCall?
    private var pushTimeout: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []
    private var seenNotifications: [String] = []

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

    private func vaultQuery(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.hasPrefix("occ."), key.count <= 512 else { call.reject("Invalid vault key"); return nil }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "dev.hvhbigname.occ.vault", kSecAttrAccount as String: key]
    }

    @objc func readSecure(_ call: CAPPluginCall) {
        guard var query = vaultQuery(call) else { return }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve([:]); return }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("Keychain недоступен (\(status)). Разблокируйте устройство и повторите."); return
        }
        call.resolve(["value": value])
    }

    @objc func writeSecure(_ call: CAPPluginCall) {
        guard var query = vaultQuery(call) else { return }
        guard let value = call.getString("value"), value.utf8.count <= 2 * 1024 * 1024, let data = value.data(using: .utf8) else { call.reject("Invalid vault value"); return }
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }
        guard status == errSecSuccess else { call.reject("Не удалось записать в Keychain (\(status))"); return }
        call.resolve()
    }

    @objc func removeSecure(_ call: CAPPluginCall) {
        guard let query = vaultQuery(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Не удалось удалить запись Keychain (\(status))"); return }
        call.resolve()
    }

    @objc func startEvents(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let text = call.getString("url"), let url = URL(string: text), ["https", "http"].contains(url.scheme ?? "") else { call.reject("Invalid event URL"); return }
            self.stream?.stop()
            self.notifications = call.getBool("notifications") ?? false
            self.stream = PocketEventStream(url: url, authorization: call.getString("authorization") ?? "", onEvent: { [weak self] data in
                self?.notifyListeners("serverEvent", data: ["data": data])
                self?.notifyRequest(data)
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

    private func notifyRequest(_ raw: String) {
        guard notifications, let data = raw.data(using: .utf8), let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let event = envelope["payload"] as? [String: Any] ?? envelope
        guard let type = event["type"] as? String, let properties = event["properties"] as? [String: Any] else { return }
        let sessionID = properties["sessionID"] as? String ?? ""
        let kind = type.hasPrefix("question.") ? "question" : type.hasPrefix("permission.") ? "permission" : "error"
        let identifier = "occ.\(kind).\(sessionID)"
        let center = UNUserNotificationCenter.current()
        if type.hasSuffix(".replied") || type.hasSuffix(".rejected") {
            center.removeDeliveredNotifications(withIdentifiers: [identifier])
            return
        }
        let content = UNMutableNotificationContent()
        switch type {
        case "question.asked", "question.v2.asked":
            content.title = "У OpenCode есть вопрос"
            content.body = "Ваш ответ нужен для продолжения работы."
        case "permission.asked", "permission.v2.asked":
            content.title = "OpenCode ждёт разрешения"
            content.body = "Откройте OCC, чтобы проверить действие."
        case "session.error":
            content.title = "OpenCode: нужна помощь"
            content.body = "В сессии произошла ошибка. Подробности в OCC."
        default: return
        }
        let eventID = event["id"] as? String ?? "\(type):\(properties["id"] as? String ?? ""):\(sessionID)"
        if seenNotifications.contains(eventID) { return }
        seenNotifications.append(eventID)
        if seenNotifications.count > 256 { seenNotifications.removeFirst() }
        content.sound = .default
        content.userInfo = ["sessionID": sessionID]
        content.threadIdentifier = sessionID
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil)) { error in
            if let error = error { NSLog("OCC notification: %@", error.localizedDescription) }
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler(notification.request.trigger is UNPushNotificationTrigger ? [] : [.banner, .sound])
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
