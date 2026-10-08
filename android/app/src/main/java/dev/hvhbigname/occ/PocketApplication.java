package dev.hvhbigname.occ;

import android.app.Application;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

public class PocketApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try { recordCrash(error); }
            catch (Throwable storageFailure) { android.util.Log.e("OCC", "Native crash report could not be saved"); }
            finally {
                if (previous != null) previous.uncaughtException(thread, error);
                else { android.os.Process.killProcess(android.os.Process.myPid()); System.exit(10); }
            }
        });
    }

    private void recordCrash(Throwable error) throws Exception {
        PocketVault vault = new PocketVault(this);
        String preferences = vault.read("occ.preferences");
        if (preferences != null && !new JSONObject(preferences).optBoolean("diagnostics", true)) return;
        JSONArray frames = new JSONArray();
        for (StackTraceElement element : error.getStackTrace()) {
            String frame = element.getClassName() + "." + element.getMethodName() + "(" + (element.getFileName() == null ? "Native" : element.getFileName()) + ":" + element.getLineNumber() + ")";
            frames.put(frame.length() > 160 ? frame.substring(0, 160) : frame);
            if (frames.length() >= 12) break;
        }
        String name = error.getClass().getName();
        if (name.length() > 80) name = name.substring(0, 80);
        String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        JSONObject report = new JSONObject().put("schema", 1).put("id", UUID.randomUUID().toString())
            .put("timestamp", System.currentTimeMillis()).put("version", version == null ? "1.0.0" : version)
            .put("platform", "android").put("kind", "native-crash").put("severity", "fatal")
            .put("name", name).put("operation", "unknown").put("screen", "unknown")
            .put("frames", frames).put("osVersion", String.valueOf(Build.VERSION.SDK_INT));
        String saved = vault.read("occ.nativeReports");
        JSONArray reports = saved == null ? new JSONArray() : new JSONArray(saved);
        reports.put(report);
        while (reports.length() > 20) reports.remove(0);
        vault.write("occ.nativeReports", reports.toString());
    }
}
