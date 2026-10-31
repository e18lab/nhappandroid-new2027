/**
 * ПК или телефон/планшет — по платформе, а не по ширине окна: узкое окно на ПК остаётся ПК-версией
 * (своя шапка-заголовок окна, боковая панель), планшет в ландшафте — мобильной.
 * На ПК у `<html>` класс `is-desktop`.
 * В разработке в обычном браузере (не Tauri) — всегда мобильная версия, чтобы смотреть её рядом с `tauri dev`;
 * ПК-версия в браузере — по `?desktop` в адресе (до `#`).
 */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

const DEV_BROWSER_MOBILE =
  import.meta.env.DEV && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && !/[?&]desktop/.test(window.location.search);

export const IS_DESKTOP = !DEV_BROWSER_MOBILE && !/Android|iPhone|iPad|iPod|Mobile/i.test(ua);

if (IS_DESKTOP && typeof document !== "undefined") document.documentElement.classList.add("is-desktop");
