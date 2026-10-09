package dev.hvhbigname.occ;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.util.LinkedHashSet;
import java.util.HashMap;

public class PocketEventService extends Service implements EventConnection.Listener {
    static volatile EventConnection.Listener listener;
    private static final String CONNECTION = "occ-connection";
    private static final String REQUESTS = "occ-requests";
    private static final int FOREGROUND_ID = 1337;
    private EventConnection events;
    private String serverName = "OpenCode";
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private final HashMap<String, Long> recent = new HashMap<>();
    private final HashMap<String, Integer> requestNotifications = new HashMap<>();
    private String scope = "";

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CONNECTION, "Соединение OCC", NotificationManager.IMPORTANCE_LOW));
            NotificationChannel requests = new NotificationChannel(REQUESTS, "Вопросы и разрешения OpenCode", NotificationManager.IMPORTANCE_HIGH);
            requests.setDescription("Когда OpenCode ждёт ваш ответ или разрешение");
            manager.createNotificationChannel(requests);
        }
    }

    @Override public synchronized int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getStringExtra("url") == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (events != null) events.close();
        serverName = intent.getStringExtra("name") == null ? "OpenCode" : intent.getStringExtra("name");
        String nextScope = intent.getStringExtra("url");
        if (!nextScope.equals(scope)) { seen.clear(); recent.clear(); requestNotifications.clear(); scope = nextScope; }
        Notification notification = connectionNotification("Подключаемся к " + serverName);
        if (Build.VERSION.SDK_INT >= 34) startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(FOREGROUND_ID, notification);
        events = new EventConnection(intent.getStringExtra("url"), intent.getStringExtra("authorization") == null ? "" : intent.getStringExtra("authorization"), this);
        events.start();
        return START_NOT_STICKY;
    }

    private PendingIntent open(String sessionID, int id) {
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (!sessionID.isEmpty()) intent.putExtra("occSessionID", sessionID);
        return PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification connectionNotification(String message) {
        return new NotificationCompat.Builder(this, CONNECTION).setSmallIcon(R.drawable.ic_occ_notification)
            .setContentTitle("OpenCode Pocket").setContentText(message).setOngoing(true).setSilent(true)
            .setContentIntent(open("", FOREGROUND_ID)).setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
    }

    @Override public void onState(boolean connected, String message) {
        EventConnection.Listener current = listener;
        if (current != null) current.onState(connected, message);
        getSystemService(NotificationManager.class).notify(FOREGROUND_ID, connectionNotification(connected ? serverName + " · на связи" : "Восстанавливаем связь с " + serverName));
    }

    @Override public synchronized void onEvent(String data) {
        EventConnection.Listener current = listener;
        if (current != null) current.onEvent(data);
        try {
            JSONObject envelope = new JSONObject(data);
            JSONObject event = envelope.optJSONObject("payload") == null ? envelope : envelope.getJSONObject("payload");
            String type = event.optString("type");
            JSONObject properties = event.optJSONObject("properties");
            if (properties == null) return;
            String sessionID = properties.optString("sessionID");
            String kind = type.startsWith("question.") ? "question" : type.startsWith("permission.") ? "permission" : "error";
            String requestID = properties.optString("id");
            int id = (scope + sessionID + kind + requestID).hashCode() & 0x7fffffff;
            if (id == FOREGROUND_ID) id++;
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (type.endsWith(".replied") || type.endsWith(".rejected")) {
                Integer requestNotification = requestNotifications.remove(kind + ":" + properties.optString("requestID"));
                if (requestNotification != null) manager.cancel(requestNotification);
                return;
            }
            if (sessionID.isEmpty()) return;
            String title;
            String body;
            if (type.equals("question.asked") || type.equals("question.v2.asked")) { title = "У OpenCode есть вопрос"; body = "Ваш ответ нужен для продолжения работы."; }
            else if (type.equals("permission.asked") || type.equals("permission.v2.asked")) { title = "OpenCode ждёт разрешения"; body = "Откройте OCC, чтобы проверить действие."; }
            else if (type.equals("session.error")) {
                JSONObject error = properties.optJSONObject("error");
                if (error != null && "MessageAbortedError".equals(error.optString("name"))) return;
                title = "Ошибка в сессии OpenCode"; body = "В сессии произошла ошибка. Подробности в OCC.";
            }
            else return;
            String sourceID = requestID.isEmpty() ? event.optString("id") : requestID;
            String eventID = kind + ":" + sessionID + ":" + sourceID;
            if (!sourceID.isEmpty() && !seen.add(eventID)) return;
            if (seen.size() > 256) seen.remove(seen.iterator().next());
            String channel = kind + ":" + sessionID;
            long now = System.currentTimeMillis();
            Long previous = recent.get(channel);
            if (previous != null && now - previous < (kind.equals("error") ? 60000 : sourceID.isEmpty() ? 10000 : 0)) return;
            recent.put(channel, now);
            if (recent.size() > 256) recent.clear();
            if (MainActivity.visible) return;
            if (!requestID.isEmpty()) {
                requestNotifications.put(kind + ":" + requestID, id);
                if (requestNotifications.size() > 256) requestNotifications.clear();
            }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            manager.notify(id, new NotificationCompat.Builder(this, REQUESTS).setSmallIcon(R.drawable.ic_occ_notification)
                .setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(open(sessionID, id))
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
        } catch (org.json.JSONException error) {
            android.util.Log.w("OCC", "Malformed server event");
        }
    }

    @Override public void onDestroy() {
        if (events != null) events.close();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
