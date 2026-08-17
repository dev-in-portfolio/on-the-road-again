package com.darkstar.otra;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OtraNavigation")
public class OtraNavigationPlugin extends Plugin {
    private void start(Intent intent) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.startActivity(intent);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
    }

    @PluginMethod
    public void openGoogleMaps(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception error) {
            call.reject("Invalid Google Maps URL.", error);
            return;
        }

        String scheme = uri.getScheme();
        String host = uri.getHost();
        String path = uri.getPath();
        boolean allowedHost = host != null && (
                host.equalsIgnoreCase("www.google.com")
                        || host.equalsIgnoreCase("google.com")
                        || host.equalsIgnoreCase("maps.google.com")
        );
        if (!"https".equalsIgnoreCase(scheme) || !allowedHost || path == null || !path.startsWith("/maps/")) {
            call.reject("Only Google Maps HTTPS URLs are allowed.");
            return;
        }

        JSObject result = new JSObject();
        Intent mapsIntent = new Intent(Intent.ACTION_VIEW, uri);
        mapsIntent.setPackage("com.google.android.apps.maps");
        try {
            start(mapsIntent);
            result.put("opened", "google_maps");
            call.resolve(result);
            return;
        } catch (ActivityNotFoundException ignored) {
            // Google Maps is not installed. Fall back to Android's normal HTTPS handler.
        }

        try {
            start(new Intent(Intent.ACTION_VIEW, uri));
            result.put("opened", "fallback");
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("No application is available to open Google Maps.", error);
        }
    }
}
