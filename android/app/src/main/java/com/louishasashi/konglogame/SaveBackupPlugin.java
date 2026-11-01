package com.louishasashi.konglogame;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(
    name = "SaveBackup",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class SaveBackupPlugin extends Plugin {

    private static final String MIME_TYPE = "application/json";

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasRequiredPermissions()) {
            requestPermissionForAlias("storage", call, "saveToDownloadsAfterPermission");
            return;
        }
        writeBackup(call);
    }

    @PermissionCallback
    private void saveToDownloadsAfterPermission(PluginCall call) {
        if (!hasRequiredPermissions()) {
            call.reject("Izin penyimpanan ditolak.");
            return;
        }
        writeBackup(call);
    }

    private void writeBackup(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName", "filesave.json");
        if (data == null) {
            call.reject("Data backup kosong.");
            return;
        }

        try {
            String relativePath = Environment.DIRECTORY_DOWNLOADS + "/KONGLOGAME-save/";
            Uri uri =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? writeWithMediaStore(fileName, relativePath, data)
                    : writeLegacy(fileName, data);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("path", "Download/KONGLOGAME-save/" + fileName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Gagal menyimpan backup: " + error.getMessage(), error);
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri writeWithMediaStore(String fileName, String relativePath, String data) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri existing = findExistingDownload(resolver, collection, fileName, relativePath);

        if (existing != null) {
            try (OutputStream out = resolver.openOutputStream(existing, "wt")) {
                if (out == null) throw new Exception("Tidak bisa membuka file tujuan.");
                out.write(data.getBytes(StandardCharsets.UTF_8));
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(existing, done, null, null);
            return existing;
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, MIME_TYPE);
        values.put(MediaStore.Downloads.RELATIVE_PATH, relativePath);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new Exception("Tidak bisa membuat file di Download.");

        try {
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new Exception("Tidak bisa menulis file tujuan.");
                out.write(data.getBytes(StandardCharsets.UTF_8));
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri findExistingDownload(ContentResolver resolver, Uri collection, String fileName, String relativePath) {
        String[] projection = { MediaStore.Downloads._ID };
        String selection = MediaStore.Downloads.DISPLAY_NAME + "=? AND " + MediaStore.Downloads.RELATIVE_PATH + "=?";
        String[] selectionArgs = { fileName, relativePath };
        try (Cursor cursor = resolver.query(collection, projection, selection, selectionArgs, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return ContentUris.withAppendedId(collection, cursor.getLong(0));
            }
        }
        return null;
    }

    private Uri writeLegacy(String fileName, String data) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "KONGLOGAME-save");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Tidak bisa membuat folder Download/KONGLOGAME-save.");
        }
        File file = new File(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data.getBytes(StandardCharsets.UTF_8));
        }
        return Uri.fromFile(file);
    }
}
