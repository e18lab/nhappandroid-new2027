import { useEffect, useRef } from "react";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Главная — `#/` без пути (параметры поиска не считаются). */
function isHomeRoute(): boolean {
  const path = window.location.hash.replace(/^#/, "").split("?")[0];
  return path === "" || path === "/";
}

/** Открытые оверлеи (выпадающие списки, модалки): «Назад» закрывает самый верхний. */
const overlayStack: { close: () => void }[] = [];

/**
 * Пока `active`, «Назад» (кнопка Android или Escape) вызывает `onClose` этого оверлея,
 * а не уходит со страницы. Вложенные оверлеи закрываются по одному, сверху вниз.
 */
export function useBackHandler(active: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;

  useEffect(() => {
    if (!active) return;
    const entry = { close: () => latest.current() };
    overlayStack.push(entry);
    return () => {
      const i = overlayStack.indexOf(entry);
      if (i >= 0) overlayStack.splice(i, 1);
    };
  }, [active]);
}

/** Закрыть верхний оверлей; true — если было что закрывать. */
export function closeTopOverlay(): boolean {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && closeTopOverlay()) e.preventDefault();
  });
}

/**
 * Системная кнопка «Назад» на Android.
 * Сначала закрывается верхний оверлей (`useBackHandler`), затем `onBack`
 * (возвращает true, если сам обработал нажатие — например, закрыл меню).
 * Иначе — шаг назад по истории, а с первого экрана — выход из приложения.
 */
export function useAndroidBack(onBack: () => boolean): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!inTauri()) return;
    let unregister: (() => void) | null = null;
    let disposed = false;

    (async () => {
      const { onBackButtonPress, exit } = await import("@tauri-apps/api/app");
      const listener = await onBackButtonPress(({ canGoBack }) => {
        if (closeTopOverlay()) return;
        if (handler.current()) return;
        if (canGoBack) window.history.back();
        // Истории нет (например, экран открыт по ссылке), но мы не на главной — сначала на главную.
        else if (!isHomeRoute()) window.location.replace("#/");
        else void exit(0);
      });
      if (disposed) void listener.unregister();
      else unregister = () => void listener.unregister();
    })().catch(() => {
      // На ПК слушатель не поддерживается — ничего не делаем.
    });

    return () => {
      disposed = true;
      unregister?.();
    };
  }, []);
}
