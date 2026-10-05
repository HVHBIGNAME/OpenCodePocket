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

public class PocketEventService extends Service implements EventConnection.Listener {
    static volatile EventConnection.Listener listener;
    private static final String CONNECTION = "occ-connection";
    private static final String REQUESTS = "occ-requests";
    private static final int FOREGROUND_ID = 1337;
    private EventConnection events;
    private String serverName = "OpenCode";
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();

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

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getStringExtra("url") == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (events != null) events.close();
        serverName = intent.getStringExtra("name") == null ? "OpenCode" : intent.getStringExtra("name");
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

    @Override public void onEvent(String data) {
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
            int id = (sessionID + kind).hashCode() & 0x7fffffff;
            if (id == FOREGROUND_ID) id++;
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (type.endsWith(".replied") || type.endsWith(".rejected")) { manager.cancel(id); return; }
            String title;
            String body;
            if (type.equals("question.asked") || type.equals("question.v2.asked")) { title = "У OpenCode есть вопрос"; body = "Ваш ответ нужен для продолжения работы."; }
            else if (type.equals("permission.asked") || type.equals("permission.v2.asked")) { title = "OpenCode ждёт разрешения"; body = "Откройте OCC, чтобы проверить действие."; }
            else if (type.equals("session.error")) { title = "OpenCode: нужна помощь"; body = "В сессии произошла ошибка. Подробности в OCC."; }
            else return;
            String eventID = event.optString("id", type + ":" + properties.optString("id") + ":" + sessionID);
            if (!seen.add(eventID)) return;
            if (seen.size() > 256) seen.remove(seen.iterator().next());
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            manager.notify(id, new NotificationCompat.Builder(this, REQUESTS).setSmallIcon(R.drawable.ic_occ_notification)
                .setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(open(sessionID, id))
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
