package dev.hvhbigname.occ;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;

final class EventConnection {
    interface Listener {
        void onEvent(String data);
        void onState(boolean connected, String message);
    }

    private final String url;
    private final String authorization;
    private final Listener listener;
    private volatile boolean stopped;
    private volatile HttpURLConnection connection;
    private Thread thread;
    private String lastId = "";
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();

    EventConnection(String url, String authorization, Listener listener) {
        this.url = url;
        this.authorization = authorization;
        this.listener = listener;
    }

    void start() {
        thread = new Thread(this::run, "occ-events");
        thread.setDaemon(true);
        thread.start();
    }

    void close() {
        stopped = true;
        if (thread != null) thread.interrupt();
        HttpURLConnection active = connection;
        if (active != null) active.disconnect();
    }

    private void run() {
        int failures = 0;
        while (!stopped) {
            try {
                HttpURLConnection active = (HttpURLConnection) new URL(url).openConnection();
                connection = active;
                active.setInstanceFollowRedirects(false);
                active.setConnectTimeout(15000);
                active.setReadTimeout(65000);
                active.setRequestProperty("Accept", "text/event-stream");
                active.setRequestProperty("Cache-Control", "no-cache");
                if (!authorization.isEmpty()) active.setRequestProperty("Authorization", authorization);
                if (!lastId.isEmpty()) active.setRequestProperty("Last-Event-ID", lastId);
                int status = active.getResponseCode();
                if (status == 401) {
                    listener.onEvent("{\"type\":\"occ.unauthorized\",\"properties\":{}}");
                    listener.onState(false, "Доступ отозван. Подключитесь заново.");
                    break;
                }
                if (status != 200) throw new java.io.IOException("HTTP " + status);
                failures = 0;
                listener.onState(true, "");
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(active.getInputStream(), StandardCharsets.UTF_8))) {
                    StringBuilder data = new StringBuilder();
                    String eventId = "";
                    String line;
                    while (!stopped && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (data.length() > 0) {
                                if (eventId.isEmpty() || seen.add(eventId)) listener.onEvent(data.substring(0, data.length() - 1));
                                if (!eventId.isEmpty()) lastId = eventId;
                                if (seen.size() > 512) seen.remove(seen.iterator().next());
                                data.setLength(0);
                            }
                            eventId = "";
                        } else if (line.startsWith("data:")) {
                            String value = line.substring(5);
                            data.append(value.startsWith(" ") ? value.substring(1) : value).append('\n');
                            if (data.length() > 8 * 1024 * 1024) throw new java.io.IOException("SSE event too large");
                        } else if (line.startsWith("id:")) {
                            String value = line.substring(3).trim();
                            if (value.indexOf('\0') < 0) eventId = value;
                        }
                    }
                }
            } catch (Exception error) {
                if (!stopped) listener.onState(false, error.getMessage() == null ? "Соединение потеряно" : error.getMessage());
            } finally {
                HttpURLConnection active = connection;
                connection = null;
                if (active != null) active.disconnect();
            }
            if (!stopped) {
                listener.onState(false, "Восстанавливаем соединение");
                try { Thread.sleep(Math.min(30000, 1000L << Math.min(failures++, 5))); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
            }
        }
    }
}
