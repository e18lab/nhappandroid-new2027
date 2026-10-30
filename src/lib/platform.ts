/**
 * ПК или телефон/планшет — по платформе, а не по ширине окна: узкое окно на ПК остаётся ПК-версией
 * (своя шапка-заголовок окна, боковая панель), планшет в ландшафте — мобильной.
 * На ПК у `<html>` класс `is-desktop`.
 */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const IS_DESKTOP = !/Android|iPhone|iPad|iPod|Mobile/i.test(ua);

if (IS_DESKTOP && typeof document !== "undefined") document.documentElement.classList.add("is-desktop");
