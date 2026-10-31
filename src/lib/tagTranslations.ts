/**
 * Переводы тегов от сообщества (`api/community.ts`) для показа на карточках и в книге на языке интерфейса.
 * Для выбранного языка выкачиваются все переведённые теги (`status=done`) страницами и хранятся
 * в `@nh.tagTranslations.v1.<locale>`; при запуске показывается сохранённое, свежее догружается в фоне
 * не чаще раза в REFRESH_MS. Искать, фильтровать и копировать по-прежнему по оригинальному имени.
 * Настройка «Теги на языке интерфейса» (`langPrefs.ts`) выключена — имена как на nhentai.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getTranslationTable, type TranslationLocale } from "../api/community";
import { useI18n } from "../i18n/I18nContext";
import { useLangPref } from "./langPrefs";

const PAGE = 1000;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const KEY = (l: TranslationLocale) => `@nh.tagTranslations.v1.${l}`;

interface Stored {
  at: number;
  map: Record<string, string>;
}

const maps = new Map<TranslationLocale, Map<string, string>>();
const fetchedAt = new Map<TranslationLocale, number>();
const loading = new Set<TranslationLocale>();
const listeners = new Set<() => void>();
let version = 0;

const key = (type: string, name: string) => `${type}:${name.trim().toLowerCase()}`;

function notify() {
  version++;
  for (const l of listeners) l();
}

function restore(locale: TranslationLocale): Map<string, string> {
  let map = maps.get(locale);
  if (map) return map;
  map = new Map();
  try {
    const raw = localStorage.getItem(KEY(locale));
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      for (const [k, v] of Object.entries(s.map)) map.set(k, v);
      fetchedAt.set(locale, s.at);
    }
  } catch {
    /* битые данные — выкачаем заново */
  }
  maps.set(locale, map);
  return map;
}

function persist(locale: TranslationLocale) {
  const map = maps.get(locale);
  if (!map) return;
  try {
    localStorage.setItem(KEY(locale), JSON.stringify({ at: fetchedAt.get(locale) ?? Date.now(), map: Object.fromEntries(map) } satisfies Stored));
  } catch {
    /* не влезло — останется в памяти до перезапуска */
  }
}

async function refresh(locale: TranslationLocale) {
  if (loading.has(locale)) return;
  if (Date.now() - (fetchedAt.get(locale) ?? 0) < REFRESH_MS) return;
  loading.add(locale);
  try {
    const next = new Map<string, string>();
    for (let offset = 0; ; ) {
      const res = await getTranslationTable({ search: "", tagTypes: [], locale, status: "done", sort: "name", limit: PAGE, offset });
      for (const r of res.rows) {
        const v = r.values[locale]?.trim();
        if (v) next.set(key(r.tagType, r.originalName), v);
      }
      offset += res.rows.length;
      if (!res.rows.length || offset >= res.total) break;
    }
    maps.set(locale, next);
    fetchedAt.set(locale, Date.now());
    persist(locale);
    notify();
  } catch {
    /* сервер недоступен — показываем сохранённое, попробуем при следующем открытии */
  } finally {
    loading.delete(locale);
  }
}

/** Сообщество сохранило перевод — сразу показать его без перекачки. */
export function setTagTranslation(locale: TranslationLocale, type: string, name: string, value: string) {
  const map = restore(locale);
  const v = value.trim();
  if (v) map.set(key(type, name), v);
  else map.delete(key(type, name));
  persist(locale);
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getVersion = () => version;

/** Имя тега на языке интерфейса (перевода нет — оригинал). */
export function useTagLabel(): (type: string, name: string) => string {
  const { resolved } = useI18n();
  const on = useLangPref("tags");
  const v = useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    if (!on) return;
    restore(resolved);
    void refresh(resolved);
  }, [resolved, on]);
  return useCallback(
    (type: string, name: string) => (on ? (restore(resolved).get(key(type || "tag", name)) ?? name) : name),
    // v — пересоздать функцию после догрузки, чтобы memo-компоненты перерисовались
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, on, v],
  );
}
