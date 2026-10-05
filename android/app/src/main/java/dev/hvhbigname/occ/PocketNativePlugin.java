package dev.hvhbigname.occ;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(name = "PocketNative", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class PocketNativePlugin extends Plugin implements EventConnection.Listener {
    private EventConnection foreground;
    private SpeechRecognizer recognizer;
    private PocketVault vault;

    @Override public void load() { vault = new PocketVault(getContext()); emitTap(getActivity().getIntent()); }

    @PluginMethod public void readSecure(PluginCall call) {
        try { String value = vault.read(call.getString("key")); JSObject result = new JSObject(); if (value != null) result.put("value", value); call.resolve(result); }
        catch (Exception error) { call.reject("Защищённое хранилище недоступно: " + error.getMessage()); }
    }
    @PluginMethod public void writeSecure(PluginCall call) {
        try { vault.write(call.getString("key"), call.getString("value")); call.resolve(); }
        catch (Exception error) { call.reject("Не удалось сохранить в защищённое хранилище: " + error.getMessage()); }
    }
    @PluginMethod public void removeSecure(PluginCall call) {
        try { vault.remove(call.getString("key")); call.resolve(); }
        catch (Exception error) { call.reject("Не удалось удалить защищённое значение: " + error.getMessage()); }
    }

    @PluginMethod public void startEvents(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) { call.reject("Invalid event URL"); return; }
        if (foreground != null) { foreground.close(); foreground = null; }
        boolean notifications = Boolean.TRUE.equals(call.getBoolean("notifications", false));
        if (notifications) {
            PocketEventService.listener = this;
            Intent intent = new Intent(getContext(), PocketEventService.class).putExtra("url", url)
                .putExtra("authorization", call.getString("authorization", "")).putExtra("name", call.getString("name", "OpenCode"));
            try { ContextCompat.startForegroundService(getContext(), intent); }
            catch (Exception error) { call.reject("Не удалось запустить фоновое соединение: " + error.getMessage()); return; }
        } else {
            PocketEventService.listener = null;
            getContext().stopService(new Intent(getContext(), PocketEventService.class));
            foreground = new EventConnection(url, call.getString("authorization", ""), this);
            foreground.start();
        }
        call.resolve();
    }

    @PluginMethod public void stopEvents(PluginCall call) {
        if (foreground != null) { foreground.close(); foreground = null; }
        PocketEventService.listener = null;
        getContext().stopService(new Intent(getContext(), PocketEventService.class));
        call.resolve();
    }

    @Override public void onEvent(String data) { notifyListeners("serverEvent", new JSObject().put("data", data)); }
    @Override public void onState(boolean connected, String message) { notifyListeners("connection", new JSObject().put("state", connected ? "connected" : "reconnecting").put("message", message)); }

    @PluginMethod public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(new JSObject().put("granted", true)); return; }
        requestPermissionForAlias("notifications", call, "notificationPermission");
    }
    @PermissionCallback private void notificationPermission(PluginCall call) { call.resolve(new JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED)); }
    @PluginMethod public void registerPush(PluginCall call) { call.reject("Android uses the OCC background connection instead of APNs."); }

    @PluginMethod public void startSpeech(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "speechPermission"); return; }
        beginSpeech(call);
    }
    @PermissionCallback private void speechPermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Разрешите доступ к микрофону в настройках OCC."); return; }
        beginSpeech(call);
    }

    private void beginSpeech(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) { call.reject("Диктовка уже запущена"); return; }
            boolean offline = Boolean.TRUE.equals(call.getBoolean("offline", true));
            if (offline && (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()))) {
                call.reject("Офлайн-распознавание недоступно. Установите системный языковой пакет или отключите «Только на устройстве» в настройках OCC."); return;
            }
            if (!offline && !SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("На устройстве нет системного распознавателя речи."); return; }
            try {
                recognizer = offline && Build.VERSION.SDK_INT >= 31 ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()) : SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                    @Override public void onPartialResults(Bundle results) { emitSpeech(results, false); }
                    @Override public void onResults(Bundle results) { emitSpeech(results, true); destroySpeech(); }
                    @Override public void onError(int error) {
                        String message;
                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) message = "Речь не распознана. Попробуйте ещё раз.";
                        else if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) message = "Этот язык недоступен. Скачайте языковой пакет в системном распознавателе.";
                        else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) message = "Нет разрешения на микрофон.";
                        else message = "Системное распознавание завершилось с ошибкой (" + error + "). Попробуйте снова.";
                        notifyListeners("speech", new JSObject().put("error", message).put("final", true));
                        destroySpeech();
                    }
                });
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("locale", "ru-RU"))
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                recognizer.startListening(intent);
                call.resolve();
            } catch (Exception error) { destroySpeech(); call.reject("Не удалось начать диктовку: " + error.getMessage()); }
        });
    }

    private void emitSpeech(Bundle results, boolean isFinal) {
        ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        JSObject event = new JSObject().put("final", isFinal);
        if (values != null && !values.isEmpty()) event.put("text", values.get(0));
        notifyListeners("speech", event);
    }
    private void destroySpeech() { if (recognizer != null) { recognizer.destroy(); recognizer = null; } }
    @PluginMethod public void stopSpeech(PluginCall call) { getActivity().runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); call.resolve(); }); }

    private void emitTap(Intent intent) {
        if (intent != null && intent.hasExtra("occSessionID")) {
            notifyListeners("notificationTap", new JSObject().put("sessionID", intent.getStringExtra("occSessionID")), true);
            intent.removeExtra("occSessionID");
        }
    }
    @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); emitTap(intent); }
    @Override protected void handleOnDestroy() {
        if (foreground != null) foreground.close();
        PocketEventService.listener = null;
        getActivity().runOnUiThread(this::destroySpeech);
        super.handleOnDestroy();
    }
}
