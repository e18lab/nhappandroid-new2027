/**
 * Короткая вибрация при нажатии — как `Vibration.vibrate(10)` в старом `Button` / `CardPressable`.
 * WebView может не поддерживать Vibration API — тогда тихо ничего не делаем.
 * Нативные хаптики через плагин Tauri — этап 10.
 */
export function tapFeedback(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* не поддерживается */
  }
}
