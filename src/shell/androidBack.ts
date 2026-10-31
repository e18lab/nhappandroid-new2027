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

/** Жест «назад» с прогрессом (predictive back): анимацию ведёт Shell (`usePredictiveBack`). */
export interface BackGesture {
  /** Можно ли сейчас вести экран за жестом. */
  canStart(): boolean;
  start(edge: "left" | "right"): void;
  progress(p: number): void;
  cancel(): void;
  /** Жест доведён до конца: доиграть анимацию и уйти назад. */
  commit(): void;
}

let gesture: BackGesture | null = null;
let gestureActive = false;
let fallback: (canGoBack: boolean) => void = () => {};

export function setBackGesture(g: BackGesture | null) {
  gesture = g;
}

declare global {
  interface Window {
    /** Вызывается из MainActivity (OnBackPressedCallback): жест системного «назад» и нажатие. */
    __nhBack?: {
      start(edge: "left" | "right"): void;
      progress(p: number): void;
      cancel(): void;
      press(canGoBack: boolean): void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__nhBack = {
    start(edge) {
      gestureActive = overlayStack.length === 0 && !!gesture?.canStart();
      if (gestureActive) gesture!.start(edge);
    },
    progress(p) {
      if (gestureActive) gesture?.progress(p);
    },
    cancel() {
      if (gestureActive) gesture?.cancel();
      gestureActive = false;
    },
    press(canGoBack) {
      if (gestureActive && gesture) {
        gestureActive = false;
        gesture.commit();
        return;
      }
      fallback(canGoBack);
    },
  };
}

/**
 * Системная кнопка «Назад» на Android (и жест «назад» — его ведёт MainActivity через `window.__nhBack`).
 * Сначала закрывается верхний оверлей (`useBackHandler`), затем `onBack`
 * (возвращает true, если сам обработал нажатие — например, закрыл меню).
 * Иначе — шаг назад по истории, а с первого экрана — выход из приложения.
 */
export function useAndroidBack(onBack: () => boolean): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!inTauri()) return;
    fallback = (canGoBack) => {
      if (closeTopOverlay()) return;
      if (handler.current()) return;
      if (canGoBack) window.history.back();
      // Истории нет (например, экран открыт по ссылке), но мы не на главной — сначала на главную.
      else if (!isHomeRoute()) window.location.replace("#/");
      else void import("@tauri-apps/api/app").then(({ exit }) => exit(0));
    };
    return () => {
      fallback = () => {};
    };
  }, []);
}
