package com.nhapp.android

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
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
    registerBack(webView)
  }

  /**
   * «Назад» целиком отдаётся странице (`window.__nhBack` в androidBack.ts): жест с прогрессом
   * (predictive back, Android 14+) ведёт экран за пальцем, как в Telegram, нажатие — шаг назад,
   * закрытие окна или выход. Если страница ещё не загрузилась — назад по WebView или выход.
   */
  private fun registerBack(webView: WebView) {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackStarted(backEvent: BackEventCompat) {
        val edge = if (backEvent.swipeEdge == BackEventCompat.EDGE_LEFT) "left" else "right"
        js("start('$edge')")
      }

      override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        js("progress(${backEvent.progress})")
      }

      override fun handleOnBackCancelled() {
        js("cancel()")
      }

      override fun handleOnBackPressed() {
        val canGoBack = webView.canGoBack()
        webView.evaluateJavascript("(window.__nhBack ? (window.__nhBack.press($canGoBack), 1) : 0)") { handled ->
          if (handled != "1") {
            if (canGoBack) webView.goBack() else finish()
          }
        }
      }
    })
  }

  private fun js(call: String) {
    appWebView?.evaluateJavascript("window.__nhBack && window.__nhBack.$call", null)
  }
}
