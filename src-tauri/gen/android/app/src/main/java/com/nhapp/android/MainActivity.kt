package com.nhapp.android

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Интерфейс всегда тёмный — светлые значки статус-бара и навигации.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  private var appWebView: WebView? = null

  // Мосты для страницы: данные 1.3.1 (LegacyStorage), полноэкранный режим (SystemUi), капча входа
  override fun onWebViewCreate(webView: WebView) {
    appWebView = webView
    webView.addJavascriptInterface(LegacyStorage(applicationContext), "NHAppLegacy")
    webView.addJavascriptInterface(SystemUi(this), "NHAppNative")
    webView.addJavascriptInterface(CaptchaDialog(this) { appWebView }, "NHAppCaptcha")
  }
}
