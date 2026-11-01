package com.louishasashi.konglogame;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveBackupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
