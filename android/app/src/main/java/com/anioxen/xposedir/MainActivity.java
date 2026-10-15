package com.anioxen.xposedir;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolderPickerPlugin.class);
        registerPlugin(NativeHostPlugin.class);
        super.onCreate(savedInstanceState);
    }
}