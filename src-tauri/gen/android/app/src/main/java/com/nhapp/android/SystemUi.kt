package com.nhapp.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import java.io.File
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Полноэкранный режим (`ui_fullscreen`) — замена `expo-navigation-bar` + `setStatusBarHidden` из старого
 * приложения. Статус-бар и навигация скрыты и появляются на время свайпом от края.
 * Доступно странице как `window.NHAppNative.setFullscreen(bool)`.
 *
 * Плюс данные устройства для облачной синхронизации (`utils/deviceId.ts` старого приложения),
 * «Поделиться» файлом (`expo-sharing`) и чтение буфера обмена (`expo-clipboard`) для менеджера хранилища.
 */
class SystemUi(private val activity: Activity) {
  @JavascriptInterface
  fun setFullscreen(enabled: Boolean) {
    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      if (enabled) {
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
    }
  }

  /** ANDROID_ID — как `Application.getAndroidId()` в старом: он зависит от ключа подписи, а ключ тот же. */
  @SuppressLint("HardwareIds")
  @JavascriptInterface
  fun deviceId(): String =
    Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID) ?: ""

  /** «Производитель Модель», как `manufacturer` + `modelName` из expo-device. */
  @JavascriptInterface
  fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

  /** Пишет текст во временный файл и открывает системное «Поделиться» (сохранить, отправить). */
  @JavascriptInterface
  fun shareText(fileName: String, mime: String, text: String): Boolean =
    try {
      val dir = File(activity.cacheDir, "exports").apply { mkdirs() }
      val file = File(dir, File(fileName).name).apply { writeText(text) }
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, file.name)) }
      true
    } catch (e: Exception) {
      false
    }

  /** Текст из буфера обмена: WebView не даёт странице его читать. */
  @JavascriptInterface
  fun clipboardText(): String {
    val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = cm.primaryClip ?: return ""
    if (clip.itemCount == 0) return ""
    return clip.getItemAt(0).coerceToText(activity)?.toString() ?: ""
  }
}
