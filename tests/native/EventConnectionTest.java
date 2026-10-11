package dev.hvhbigname.occ;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class EventConnectionTest {
    public static void main(String[] args) throws Exception {
        List<String> events = new CopyOnWriteArrayList<>();
        List<String> cursors = new CopyOnWriteArrayList<>();
        AtomicInteger attempts = new AtomicInteger();
        CountDownLatch done = new CountDownLatch(4);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/events", exchange -> {
            String cursor = exchange.getRequestHeaders().getFirst("Last-Event-ID");
            cursors.add(cursor == null ? "<none>" : cursor);
            int attempt = attempts.incrementAndGet();
            exchange.getResponseHeaders().add("Content-Type", attempt == 1 ? "text/html" : "text/event-stream");
            String body = switch (attempt) {
                case 1 -> "data: this is not an event stream\n\n";
                case 2 -> "id: one\rdata: first\r\rid: one\ndata: duplicate\n\ndata: second\n\nid:\n\ndata: привет\n\n";
                case 3 -> "id: unfinished\ndata: partial\n";
                default -> "id: final\ndata: fourth\n\n";
            };
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var output = exchange.getResponseBody()) { output.write(bytes); }
        });
        server.start();
        EventConnection connection = new EventConnection("http://127.0.0.1:" + server.getAddress().getPort() + "/events", "", new EventConnection.Listener() {
            public void onEvent(String data) { events.add(data); done.countDown(); }
            public void onState(boolean connected, String message) { }
        });
        try {
            connection.start();
            if (!done.await(12, TimeUnit.SECONDS)) throw new AssertionError("Timed out: " + events);
            if (!events.equals(List.of("first", "second", "привет", "fourth"))) throw new AssertionError("Invalid events: " + events);
            if (!cursors.equals(List.of("<none>", "<none>", "<none>", "<none>"))) throw new AssertionError("Acknowledged a reset or incomplete frame: " + cursors);
            System.out.println("PASS Android SSE: content type, CR/LF, UTF-8, replay deduplication, cursor reset and incomplete-frame reconnect");
        } finally {
            connection.close();
            server.stop(0);
        }
    }
}
