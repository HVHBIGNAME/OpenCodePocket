package dev.hvhbigname.occ;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PocketNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
