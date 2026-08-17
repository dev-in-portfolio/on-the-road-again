package com.darkstar.otra;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "OtraUpdater")
public class OtraUpdaterPlugin extends Plugin {
    private void start(Intent intent) {
        Activity activity = getActivity();
        if (activity != null) activity.startActivity(intent);
        else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
    }

    private void openUnknownSourcesSettings() {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        start(intent);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String fileName = call.getString("fileName", "");
        if (!fileName.matches("otra-[A-Za-z0-9._-]+\\.apk")) {
            call.reject("Invalid APK filename.");
            return;
        }

        File apk = new File(getContext().getCacheDir(), fileName);
        if (!apk.isFile()) {
            call.reject("Verified APK is not available in the app cache.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                openUnknownSourcesSettings();
                JSObject result = new JSObject();
                result.put("status", "permission_settings_opened");
                call.resolve(result);
            } catch (ActivityNotFoundException error) {
                call.reject("Android install-permission settings are unavailable.", error);
            }
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            start(intent);
            JSObject result = new JSObject();
            result.put("status", "installer_opened");
            call.resolve(result);
        } catch (IllegalArgumentException error) {
            call.reject("APK cache file could not be shared with Android Package Installer.", error);
        } catch (SecurityException error) {
            try {
                openUnknownSourcesSettings();
                JSObject result = new JSObject();
                result.put("status", "permission_settings_opened");
                call.resolve(result);
            } catch (ActivityNotFoundException settingsError) {
                call.reject("Android install-permission settings are unavailable.", settingsError);
            }
        } catch (ActivityNotFoundException error) {
            call.reject("Android Package Installer is unavailable.", error);
        }
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            openUnknownSourcesSettings();
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("Android install-permission settings are unavailable.", error);
        }
    }
}
