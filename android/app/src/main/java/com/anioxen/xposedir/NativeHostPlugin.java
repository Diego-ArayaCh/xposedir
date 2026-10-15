package com.anioxen.xposedir;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Host-side services the Node runtime cannot provide itself:
 * foreground service, Wi-Fi multicast lock (without it the driver drops mDNS
 * packets and Bonjour discovery never sees anything) and device info.
 *
 * Called from mobile/api-bridge.js.
 */
@CapacitorPlugin(name = "NativeHost")
public class NativeHostPlugin extends Plugin {

    private static final int REQUEST_NOTIFICATIONS = 4002;
    private WifiManager.MulticastLock multicastLock;

    @PluginMethod
    public void startForeground(PluginCall call) {
        String url = call.getString("url", "http://localhost:3000");
        requestNotificationPermissionIfNeeded();
        ServerService.start(getContext(), url, call.getInt("port", 3000));
        call.resolve();
    }

    @PluginMethod
    public void stopForeground(PluginCall call) {
        ServerService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void onResumed(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void acquireMulticastLock(PluginCall call) {
        try {
            if (multicastLock == null) {
                WifiManager wm = (WifiManager) getContext()
                        .getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    multicastLock = wm.createMulticastLock("xposedir-mdns");
                    multicastLock.setReferenceCounted(false);
                }
            }
            if (multicastLock != null && !multicastLock.isHeld()) {
                multicastLock.acquire();
            }
        } catch (Exception e) {
            // Discovery simply falls back to the UDP broadcast probe.
        }
        call.resolve();
    }

    @PluginMethod
    public void releaseMulticastLock(PluginCall call) {
        try {
            if (multicastLock != null && multicastLock.isHeld()) {
                multicastLock.release();
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject info = new JSObject();
        info.put("model", Build.MODEL);
        info.put("manufacturer", Build.MANUFACTURER);
        info.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(info);
    }

    @PluginMethod
    public void isServing(PluginCall call) {
        JSObject info = new JSObject();
        info.put("serving", ServerService.isServing());
        call.resolve(info);
    }

    // The notification is what keeps the service visible; on Android 13+ it needs a
    // runtime grant. Asked in context (when the server starts), not at launch.
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (getActivity() == null) return;
        String permission = Manifest.permission.POST_NOTIFICATIONS;
        if (ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(getActivity(), new String[]{permission}, REQUEST_NOTIFICATIONS);
    }
}