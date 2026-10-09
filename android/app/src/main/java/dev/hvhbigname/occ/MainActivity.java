package dev.hvhbigname.occ;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static volatile boolean visible = false;
    @Override public void onResume() { super.onResume(); visible = true; }
    @Override public void onPause() { visible = false; super.onPause(); }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PocketNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
