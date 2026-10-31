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
  // Редизайн: ночная тема Anixart (значения из ресурсов APK, `values-night`). Фон и поверхности —
  // нейтральные серые как там; оттенок темы — только у акцента и выбранной «пилюли» (там — лаванда).
  // Имена те же, что в старом приложении, — экраны и кит берут их как раньше.
  return {
    bg: "#121212", // screen_background
    page: "#121212",
    shadow: "#000",
    accent: hsbToHex(27, 247), // lavender #e8def8 при оттенке 266°
    txt: "#e0e0e0", // primaryTextColor
    sub: "#9e9e9e", // secondaryTextColor
    title: "#e0e0e0",
    metaText: "#9e9e9e",
    tagBg: "#252525",
    tagText: "#e0e0e0",
    newBadgeBg: "#f04e5c", // carmine
    incBg: hsbToHex(58, 88),
    incTxt: hsbToHex(27, 247),
    excBg: "#3a1b1b", // dialog_danger_background
    excTxt: "#ff8a80",
    searchBg: "#252525", // search_bar_alt
    searchTxt: "#e0e0e0",
    menuBg: "#252525",
    menuTxt: "#e0e0e0",
    related: "#1a1a1a", // backgroundColorTertiary
    surfaceElevated: "#252525", // backgroundColorSecondary
    iconOnSurface: "#e0e0e0",
  };
}

/**
 * Токены нового кита (`--ax-*`), из ночной темы Anixart: поверхности, выбранная «пилюля»
 * (bottom_nav_indicator_active #494458 — здесь с оттенком темы), подпись выбранного (…_label_checked),
 * нижняя панель (bottom_nav_background), неактивные иконки панели, разделитель.
 */
export function kitTokens(): Record<string, string> {
  return {
    "--ax-surface": "#1a1a1a",
    "--ax-surface-2": "#252525",
    "--ax-selected": hsbToHex(58, 88),
    "--ax-on-selected": hsbToHex(24, 247),
    "--ax-line": "rgba(255, 255, 255, 0.1)",
    "--ax-nav": "#252525",
    "--ax-nav-icon": "#757575",
    "--ax-muted": "#757575", // tertiaryTextColor
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
  for (const [name, value] of Object.entries(kitTokens())) root.style.setProperty(name, value);
  root.style.colorScheme = "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.page);
}
