# Методы мостов для WebView (LegacyStorage, SystemUi, CaptchaDialog) вызываются из JS — R8 не должен их удалять
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
