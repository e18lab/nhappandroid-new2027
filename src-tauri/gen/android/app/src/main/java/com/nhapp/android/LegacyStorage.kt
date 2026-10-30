package com.nhapp.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Данные старого приложения (1.3.1, React Native): AsyncStorage хранит всё в SQLite
 * `databases/RKStorage`, таблица `catalystLocalStorage (key, value)`.
 * Новое приложение читает их один раз при первом запуске (`src/lib/importLegacyStorage.ts`)
 * через `window.NHAppLegacy`. База только читается и остаётся на месте.
 */
class LegacyStorage(private val context: Context) {
  /** Все ключи и значения одним JSON-объектом или пустая строка, если базы нет. */
  @JavascriptInterface
  fun readAll(): String {
    val file = context.getDatabasePath("RKStorage")
    if (!file.exists()) return ""
    return try {
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        db.rawQuery("SELECT key, value FROM catalystLocalStorage", null).use { cursor ->
          val out = JSONObject()
          while (cursor.moveToNext()) {
            out.put(cursor.getString(0), cursor.getString(1))
          }
          out.toString()
        }
      }
    } catch (e: Exception) {
      ""
    }
  }
}
