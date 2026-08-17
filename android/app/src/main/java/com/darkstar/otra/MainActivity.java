package com.darkstar.otra;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(OtraUpdaterPlugin.class);
        registerPlugin(OtraNavigationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
