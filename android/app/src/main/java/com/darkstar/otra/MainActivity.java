package com.darkstar.otra;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(OtraUpdaterPlugin.class);
        registerPlugin(OtraNavigationPlugin.class);
        super.onCreate(savedInstanceState);
        installSystemInsetBridge();
    }

    private void installSystemInsetBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets navigationBars = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            float density = getResources().getDisplayMetrics().density;
            float bottomDp = density > 0 ? navigationBars.bottom / density : navigationBars.bottom;
            String cssValue = String.format(Locale.US, "%.2fpx", bottomDp);
            view.post(() -> {
                if (getBridge() == null || getBridge().getWebView() == null) return;
                String script = "document.documentElement.style.setProperty('--native-bottom-inset','" + cssValue + "')";
                getBridge().getWebView().evaluateJavascript(script, null);
            });
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
