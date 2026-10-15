package com.anioxen.xposedir;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Picks the folder to share.
 *
 * Node's `fs` needs a real path, so SAF alone is not enough: the tree URI is
 * translated back to its path on primary storage (/storage/emulated/0/...), which
 * requires "All files access". That permission is special app access — there is no
 * system dialog, the user flips a switch in Settings — so the request is explained
 * first and only triggered when the user asks for a folder (never at app start).
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    private static final int REQUEST_ALL_FILES = 4001;

    @PluginMethod
    public void choose(PluginCall call) {
        if (hasAllFilesAccess()) {
            openPicker(call);
        } else {
            explainAndAskForAccess(call);
        }
    }

    private boolean hasAllFilesAccess() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager();
    }

    private void explainAndAskForAccess(PluginCall call) {
        if (getActivity() == null) {
            call.reject("No activity available");
            return;
        }
        new AlertDialog.Builder(getActivity())
                .setTitle("Permiso de archivos")
                .setMessage(
                        "Para compartir una carpeta, XposeDir necesita acceso a todos los archivos.\n\n"
                                + "Es un ajuste especial del sistema: pulsa «Abrir ajustes» y activa "
                                + "«Permitir acceso a todos los archivos» para XposeDir.\n\n"
                                + "Android no muestra un diálogo automático para este permiso, "
                                + "por eso hay que activarlo manualmente.")
                .setPositiveButton("Abrir ajustes", (d, w) -> {
                    try {
                        Intent i = new Intent(
                                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:" + getContext().getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(i);
                    } catch (Exception e) {
                        try {
                            Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            getContext().startActivity(i);
                        } catch (Exception ignored) {
                        }
                    }
                    resolveNoFolder(call);
                })
                .setNegativeButton("Ahora no", (d, w) -> resolveNoFolder(call))
                .setCancelable(true)
                .setOnCancelListener(d -> resolveNoFolder(call))
                .show();
    }

    private void resolveNoFolder(PluginCall call) {
        // index.html treats null as "cancelled", so the UI needs no changes.
        JSObject ret = new JSObject();
        ret.put("path", (String) null);
        call.resolve(ret);
    }

    private void openPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFolder");
    }

    @ActivityCallback
    private void pickFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            resolveNoFolder(call);
            return;
        }

        String path = toRealPath(uri);
        if (path == null) {
            call.reject("Solo se pueden compartir carpetas del almacenamiento interno "
                    + "(el runtime Node necesita una ruta real del sistema de archivos).");
            return;
        }

        File folder = new File(path);
        if (!folder.isDirectory() || !folder.canRead()) {
            call.reject("No se puede leer la carpeta seleccionada: " + path);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("path", folder.getAbsolutePath());
        call.resolve(ret);
    }

    /**
     * "primary:Download/Xposedir" -> "/storage/emulated/0/Download/Xposedir".
     * Other volumes (SD card, OTG) are rejected: they are not plain paths.
     */
    private String toRealPath(Uri uri) {
        String root = Environment.getExternalStorageDirectory().getAbsolutePath();
        String documentId;
        try {
            documentId = DocumentsContract.getTreeDocumentId(uri);
        } catch (Exception e) {
            return null;
        }
        if (documentId == null) return null;

        int colon = documentId.indexOf(':');
        if (colon < 0) return null;
        String volume = documentId.substring(0, colon);
        String relative = documentId.substring(colon + 1);

        if (!"primary".equals(volume)) return null;
        if (relative.isEmpty()) return root;
        return root + "/" + relative;
    }
}