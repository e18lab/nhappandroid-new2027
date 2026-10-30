/**
 * Полноэкранный режим (`ui_fullscreen`). На Android — скрытие статус-бара и навигации через
 * `window.NHAppNative` (SystemUi.kt), в браузере и на ПК — Fullscreen API.
 */
import { KEYS, getItem } from "../lib/storage";

declare global {
  interface Window {
    NHAppNative?: {
      setFullscreen(enabled: boolean): void;
      deviceId?(): string;
      deviceName?(): string;
      shareText?(fileName: string, mime: string, text: string): boolean;
      clipboardText?(): string;
    };
  }
}

export function applyFullscreen(enabled: boolean): void {
  if (window.NHAppNative) {
    window.NHAppNative.setFullscreen(enabled);
    return;
  }
  try {
    if (enabled) void document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) void document.exitFullscreen();
  } catch {
    /* не поддерживается */
  }
}

/** При запуске: на Android восстанавливаем сохранённое состояние (Fullscreen API без жеста не включится). */
export function restoreFullscreen(): void {
  if (window.NHAppNative && getItem(KEYS.fullscreen) === "true") applyFullscreen(true);
}
