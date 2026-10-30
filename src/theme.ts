/** Та же модель цвета, что в старом приложении: HSB от базового оттенка. */

import { KEYS, getItem, setItem } from "./lib/storage";

let baseHue = Math.round((260 / 360) * 65535);

export function getBaseHue(): number {
  return (baseHue / 65535) * 360;
}

export function setBaseHue(deg: number): void {
  const norm = ((deg % 360) + 360) % 360;
  baseHue = Math.round((norm / 360) * 65535);
}

const toHex = (c: number) =>
  ("0" + Math.round(c).toString(16)).slice(-2).toUpperCase();

export function hsbToHex(saturation: number, brightness: number): string {
  const h = (baseHue / 65535) * 360;
  const s = saturation / 254;
  const v = brightness / 254;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Полная палитра старого `lib/ThemeContext.tsx` — те же имена и те же HSB-значения. */
export interface ThemeColors {
  bg: string;
  page: string;
  shadow: string;
  accent: string;
  txt: string;
  sub: string;
  title: string;
  metaText: string;
  tagBg: string;
  tagText: string;
  newBadgeBg: string;
  incBg: string;
  incTxt: string;
  excBg: string;
  excTxt: string;
  searchBg: string;
  searchTxt: string;
  menuBg: string;
  menuTxt: string;
  related: string;
  surfaceElevated: string;
  iconOnSurface: string;
}

export function themeColors(): ThemeColors {
  return {
    bg: hsbToHex(6, 36),
    page: hsbToHex(6, 28),
    shadow: "#000",
    accent: hsbToHex(78, 210),
    txt: hsbToHex(6, 235),
    sub: hsbToHex(0, 150),
    title: hsbToHex(16, 225),
    metaText: hsbToHex(8, 200),
    tagBg: hsbToHex(10, 48),
    tagText: hsbToHex(8, 225),
    newBadgeBg: "#ff4757",
    incBg: hsbToHex(52, 54),
    incTxt: hsbToHex(20, 225),
    excBg: hsbToHex(0, 42),
    excTxt: hsbToHex(0, 210),
    searchBg: hsbToHex(6, 34),
    searchTxt: hsbToHex(6, 235),
    menuBg: hsbToHex(6, 32),
    menuTxt: hsbToHex(6, 235),
    related: hsbToHex(6, 28),
    surfaceElevated: hsbToHex(6, 34),
    iconOnSurface: hsbToHex(8, 210),
  };
}

function hexLuminance(hex: string): number {
  const h = hex.replace(/^#/, "").slice(0, 6);
  if (h.length !== 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Цвет текста поверх фона — как `contrastTextOn` в старом `uikit/Button.tsx`. */
export function contrastTextOn(backgroundHex: string): string {
  return hexLuminance(backgroundHex) > 0.45 ? "#1a1a1b" : "#ffffff";
}

/**
 * Как в старом `lib/ThemeContext.tsx`: `Number(null)` = 0, поэтому без сохранённого значения
 * оттенок 0°. Мусор в ключе (NaN) — оставляем оттенок по умолчанию.
 */
export function loadHue(): number {
  const deg = Number(getItem(KEYS.themeHue));
  if (Number.isFinite(deg)) return ((deg % 360) + 360) % 360;
  return getBaseHue();
}

export function saveHue(deg: number): void {
  setItem(KEYS.themeHue, String(deg));
}

/** Палитра → CSS-переменные на <html>. Имена: camelCase → kebab-case (`surfaceElevated` → `--surface-elevated`). */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
  // Короткие имена, которыми уже пользуется styles.css
  root.style.setProperty("--meta", colors.metaText);
  root.style.setProperty("--surface", colors.surfaceElevated);
  root.style.setProperty("--icon", colors.iconOnSurface);
  root.style.setProperty("--on-accent", contrastTextOn(colors.accent));
  root.style.colorScheme = "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.page);
}
