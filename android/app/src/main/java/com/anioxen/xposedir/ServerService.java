package com.anioxen.xposedir;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the Node.js runtime (and therefore the HTTP server) alive while the app is
 * backgrounded. Without a foreground service Android kills the process a few
 * seconds after the app leaves the foreground, which drops the server mid-transfer.
 *
 * The service does not own the server; it only advertises it. main.js decides when
 * to start/stop it through NativeHostPlugin.
 */
public class ServerService extends Service {

    public static final String CHANNEL_ID = "xposedir_server";
    public static final String ACTION_STOP = "com.anioxen.xposedir.action.STOP_SERVER";

    private static final int NOTIFICATION_ID = 4711;
    private static volatile String servingUrl = null;

    public static void start(Context context, String url, int port) {
        servingUrl = url;
        Intent i = new Intent(context, ServerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(i);
        } else {
            context.startService(i);
        }
    }

    public static void stop(Context context) {
        servingUrl = null;
        context.stopService(new Intent(context, ServerService.class));
    }

    public static boolean isServing() {
        return servingUrl != null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String url = servingUrl;
        if (url == null) {
            // Restarted by the system but nobody is serving: don't linger.
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification(url));

        // The server itself lives in this process, so if the process dies the
        // runtime dies too; restarting the service on its own would be pointless.
        return START_NOT_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Servidor de archivos",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Se mantiene activo mientras compartes archivos por la red local");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String url) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | immutable());

        Intent stop = new Intent(this, ServerService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
                this, 1, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | immutable());

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("XposeDir está compartiendo archivos")
                .setContentText(url)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(new NotificationCompat.Action.Builder(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        "Detener",
                        stopIntent).build())
                .build();
    }

    private static int immutable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE
                : 0;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}