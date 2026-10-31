/**
 * Настройки → Язык: показывать ли названия книг и теги на языке интерфейса.
 * Обе по умолчанию включены; выключено — как на nhentai (оригинальное название, теги без перевода).
 */
import { useSyncExternalStore } from "react";
import { KEYS, getItem, setItem, subscribe } from "./storage";

export type LangPref = "titles" | "tags";

const KEY: Record<LangPref, string> = { titles: KEYS.titlesInAppLang, tags: KEYS.tagsInAppLang };

export function getLangPref(pref: LangPref): boolean {
  return getItem(KEY[pref]) !== "false";
}

export function setLangPref(pref: LangPref, on: boolean): void {
  setItem(KEY[pref], on ? "true" : "false");
}

export function useLangPref(pref: LangPref): boolean {
  return useSyncExternalStore(
    (cb) => subscribe((key) => key === KEY[pref] && cb()),
    () => getLangPref(pref),
  );
}
