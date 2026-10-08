import Foundation
import Security

enum PocketKeychain {
    private static func query(_ key: String) throws -> [String: Any] {
        guard key.hasPrefix("occ."), key.count <= 512 else { throw failure(-1) }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.hvhbigname.occ.vault", kSecAttrAccount as String: key]
    }
    private static func failure(_ code: OSStatus) -> NSError { NSError(domain: "OCC.Keychain", code: Int(code), userInfo: [NSLocalizedDescriptionKey: "Keychain operation failed (\(code)). Unlock the device and retry."]) }

    static func read(_ key: String) throws -> String? {
        var input = try query(key)
        input[kSecReturnData as String] = true
        input[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(input as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw failure(status) }
        return value
    }
    static func write(_ key: String, _ value: String) throws {
        var input = try query(key)
        guard value.utf8.count <= 2 * 1024 * 1024, let data = value.data(using: .utf8) else { throw failure(-1) }
        var status = SecItemUpdate(input as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            input[kSecValueData as String] = data
            input[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(input as CFDictionary, nil)
        }
        if status != errSecSuccess { throw failure(status) }
    }
    static func remove(_ key: String) throws {
        let status = SecItemDelete(try query(key) as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound { throw failure(status) }
    }
}
