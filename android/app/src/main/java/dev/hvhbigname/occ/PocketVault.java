package dev.hvhbigname.occ;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PocketVault {
    private static final String ALIAS = "occ.vault.aes.v1";
    private final SharedPreferences preferences;

    PocketVault(Context context) { preferences = context.getSharedPreferences("occ_vault", Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    private void validate(String name) {
        if (name == null || !name.startsWith("occ.") || name.length() > 512) throw new IllegalArgumentException("Invalid vault key");
    }

    synchronized String read(String name) throws Exception {
        validate(name);
        String value = preferences.getString(name, null);
        if (value == null) return null;
        String[] pieces = value.split(":", 3);
        if (pieces.length != 3 || !pieces[0].equals("v1")) throw new IllegalStateException("Unknown vault format");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[1], Base64.NO_WRAP)));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(pieces[2], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    synchronized void write(String name, String value) throws Exception {
        validate(name);
        if (value == null || value.length() > 2 * 1024 * 1024) throw new IllegalArgumentException("Invalid vault value");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        String encrypted = "v1:" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString(name, encrypted).commit()) throw new java.io.IOException("Could not persist secure storage");
    }

    synchronized void remove(String name) throws Exception {
        validate(name);
        if (!preferences.edit().remove(name).commit()) throw new java.io.IOException("Could not remove secure value");
    }
}
