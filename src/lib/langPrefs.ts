/**
 * Настройки → Язык: показывать ли названия книг и теги на языке интерфейса.
 * Обе по умолчанию включены; выключено — как на nhentai (оригинальное название, теги без перевода).
 */
import { useSyncExternalStore } from "react";
import { KEYS, getItem, setItem, subscribe, subscribeKey } from "./storage";

export type LangPref = "titles" | "tags";

const KEY: Record<LangPref, string> = { titles: KEYS.titlesInAppLang, tags: KEYS.tagsInAppLang };

// Читается каждой карточкой при каждой отрисовке
const values: Partial<Record<LangPref, boolean>> = {};
subscribe((key) => {
  if (key === KEY.titles) delete values.titles;
  if (key === KEY.tags) delete values.tags;
});

export function getLangPref(pref: LangPref): boolean {
  return (values[pref] ??= getItem(KEY[pref]) !== "false");
}

export function setLangPref(pref: LangPref, on: boolean): void {
  setItem(KEY[pref], on ? "true" : "false");
}

const HOOKS: Record<LangPref, { sub: (cb: () => void) => () => void; get: () => boolean }> = {
  titles: { sub: (cb) => subscribeKey(KEY.titles, cb), get: () => getLangPref("titles") },
  tags: { sub: (cb) => subscribeKey(KEY.tags, cb), get: () => getLangPref("tags") },
};

export function useLangPref(pref: LangPref): boolean {
  return useSyncExternalStore(HOOKS[pref].sub, HOOKS[pref].get);
}
