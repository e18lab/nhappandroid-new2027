package com.nhapp.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.view.Window
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Капча nhentai (Cloudflare Turnstile / hCaptcha) — замена `CaptchaEmbed.tsx` старого приложения.
 * Ключ капчи привязан к nhentai.net, поэтому виджет грузится в отдельном WebView с базовым адресом
 * https://nhentai.net/ (как `source={{ html, baseUrl }}` в react-native-webview).
 * Сторонние куки включены, как по умолчанию в react-native-webview: без них Turnstile может не пройти.
 * Если виджет сообщил об ошибке — в окне текст и «Повторить». Токен (или "" при отмене) уходит
 * в страницу приложения: `window.__nhCaptchaToken(token)`.
 */
class CaptchaDialog(private val activity: Activity, private val appWebView: () -> WebView?) {
  private var dialog: Dialog? = null

  @JavascriptInterface
  fun open(siteKey: String, provider: String, title: String, errorText: String, retryText: String, cancelText: String) {
    activity.runOnUiThread { show(siteKey, provider, title, errorText, retryText, cancelText) }
  }

  private fun deliver(token: String) {
    activity.runOnUiThread {
      dialog?.setOnDismissListener(null)
      dialog?.dismiss()
      dialog = null
      appWebView()?.evaluateJavascript("window.__nhCaptchaToken && window.__nhCaptchaToken(${JSONObject.quote(token)})", null)
    }
  }

  private fun dp(v: Int) = (v * activity.resources.displayMetrics.density).toInt()

  @SuppressLint("SetJavaScriptEnabled")
  private fun show(siteKey: String, provider: String, title: String, errorText: String, retryText: String, cancelText: String) {
    dialog?.setOnDismissListener(null)
    dialog?.dismiss()
    val web = WebView(activity).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      setBackgroundColor(Color.TRANSPARENT)
      CookieManager.getInstance().setAcceptCookie(true)
      CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
      addJavascriptInterface(object {
        @JavascriptInterface
        fun post(token: String) {
          if (token.isNotEmpty()) deliver(token)
        }
      }, "NHCaptcha")
      loadDataWithBaseURL("https://nhentai.net/", html(siteKey, provider, errorText, retryText), "text/html", "utf-8", null)
    }
    val box = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#1E1E1E"))
        cornerRadius = dp(16).toFloat()
      }
      setPadding(dp(16), dp(16), dp(16), dp(8))
      addView(TextView(activity).apply {
        text = title
        setTextColor(Color.parseColor("#E6E7E9"))
        textSize = 17f
        setTypeface(typeface, Typeface.BOLD)
      })
      addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(170)).apply { topMargin = dp(8) })
      addView(Button(activity).apply {
        text = cancelText
        isAllCaps = false
        setTextColor(Color.parseColor("#9CA3AF"))
        setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { dialog?.dismiss() }
      }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
        gravity = Gravity.END
      })
    }
    dialog = Dialog(activity).apply {
      requestWindowFeature(Window.FEATURE_NO_TITLE)
      setContentView(box)
      window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      window?.setLayout((activity.resources.displayMetrics.widthPixels * 0.9).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
      setOnDismissListener {
        web.destroy()
        deliver("")
      }
      show()
    }
  }

  private fun html(siteKey: String, providerRaw: String, errorText: String, retryText: String): String {
    val hcaptcha = providerRaw.lowercase().contains("hcaptcha")
    val script = if (hcaptcha) "https://js.hcaptcha.com/1/api.js" else "https://challenges.cloudflare.com/turnstile/v0/api.js"
    return """<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>
html,body{margin:0;background:transparent;color:#ccc;font:14px sans-serif}
body{min-height:84px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
#msg button{padding:8px 16px;border:0;border-radius:10px;background:#ed2553;color:#fff;font-weight:700}
#msg p{margin:0}
</style>
</head><body><div id="root"></div><div id="msg"></div><script>
var KEY = ${JSONObject.quote(siteKey)}, HC = $hcaptcha, ERR = ${JSONObject.quote(errorText)}, RETRY = ${JSONObject.quote(retryText)};
var widget = null;
function send(t){ try { NHCaptcha.post(t || ''); } catch(e) {} }
function api(){ return HC ? window.hcaptcha : window.turnstile; }
function reset(){ try { api().reset(widget); } catch(e) { location.reload(); } }
function fail(){
  var m = document.getElementById('msg'); m.innerHTML = '';
  var p = document.createElement('p'); p.textContent = ERR; m.appendChild(p);
  var b = document.createElement('button'); b.textContent = RETRY;
  b.onclick = function(){ m.innerHTML = ''; reset(); };
  m.appendChild(b);
}
function start(){
  var a = api();
  if (!a || !a.render) { setTimeout(start, 50); return; }
  var opts = { sitekey: KEY, theme: 'dark', callback: send, 'error-callback': fail, 'expired-callback': reset };
  try { widget = a.render(HC ? document.getElementById('root') : '#root', opts); } catch(e) { fail(); }
}
var s = document.createElement('script'); s.src = '$script'; s.async = true; s.onload = start; s.onerror = fail;
document.head.appendChild(s);
</script></body></html>"""
  }
}
