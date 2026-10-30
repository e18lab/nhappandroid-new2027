/**
 * Локализация — перенос `lib/i18n/I18nContext.tsx` из старого приложения:
 * те же словари, тот же ключ `app_language` (`system | en | ru | zh | ja`),
 * `t(key, params)` с подстановкой `{name}`, при отсутствии ключа — английский, затем сам ключ.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { KEYS, getItem, setItem, subscribe } from "../lib/storage";
import { additions } from "./additions";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";

export type ResolvedLocale = "en" | "ru" | "zh" | "ja";
export type AppLocale = "system" | ResolvedLocale;
export type TFunction = (key: string, params?: Record<string, string | number>) => string;

type Tree = { [key: string]: unknown };

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const prev = out[k];
    out[k] =
      v && typeof v === "object" && prev && typeof prev === "object"
        ? merge(prev as Tree, v as Tree)
        : v;
  }
  return out;
}

const dictionaries: Record<ResolvedLocale, Tree> = {
  en: merge(en, additions.en),
  ru: merge(ru, additions.ru),
  ja: merge(ja, additions.ja),
  zh: merge(zh, additions.zh),
};

const LOCALES: AppLocale[] = ["system", "en", "ru", "zh", "ja"];

function isAppLocale(v: unknown): v is AppLocale {
  return LOCALES.includes(v as AppLocale);
}

/** Как `normalizeDeviceLocale` в старом: украинский и белорусский → русский. */
function deviceLocale(): ResolvedLocale {
  const tag = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
  if (tag.startsWith("ru") || tag.startsWith("uk") || tag.startsWith("be")) return "ru";
  if (tag.startsWith("zh")) return "zh";
  if (tag.startsWith("ja")) return "ja";
  return "en";
}

function lookup(dict: Tree, key: string): unknown {
  // Сначала ключ целиком (в словарях есть ключи с точками на верхнем уровне), потом по пути.
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  return key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Tree)[k] : undefined),
    dict,
  );
}

function makeT(locale: ResolvedLocale): TFunction {
  const dict = dictionaries[locale];
  return (key, params) => {
    const found = lookup(dict, key) ?? lookup(dictionaries.en, key);
    const raw = typeof found === "string" ? found : key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
  };
}

function loadLocale(): AppLocale {
  const saved = getItem(KEYS.language);
  return isAppLocale(saved) ? saved : "system";
}

interface I18nValue {
  locale: AppLocale;
  resolved: ResolvedLocale;
  setLocale: (l: AppLocale) => void;
  t: TFunction;
  available: { code: AppLocale; label: string }[];
}

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(loadLocale);
  const resolved = locale === "system" ? deviceLocale() : locale;

  useEffect(
    () =>
      subscribe((key) => {
        if (key === KEYS.language) setLocaleState(loadLocale());
      }),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);

  const value = useMemo<I18nValue>(() => {
    const t = makeT(resolved);
    return {
      locale,
      resolved,
      setLocale: (l) => {
        setLocaleState(l);
        setItem(KEYS.language, l);
      },
      t,
      available: [
        { code: "system", label: t("settings.language.system") },
        { code: "en", label: t("settings.language.english") },
        { code: "ru", label: t("settings.language.russian") },
        { code: "zh", label: t("settings.language.chinese") },
        { code: "ja", label: t("settings.language.japanese") },
      ],
    };
  }, [locale, resolved]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Текст ошибки: у ApiError и других ошибок с полем `i18nKey` — перевод, иначе `fallbackKey`. */
export function errorText(t: TFunction, error: unknown, fallbackKey: string): string {
  const key = (error as { i18nKey?: unknown } | null)?.i18nKey;
  return t(typeof key === "string" ? key : fallbackKey);
}
