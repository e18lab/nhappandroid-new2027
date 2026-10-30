/**
 * Единая точка доступа к хранилищу (замена AsyncStorage из старого приложения).
 *
 * Ключи и формат значений — как в ветке `master` старого приложения, без префиксов:
 * это нужно для облачной синхронизации (`api/nhappApi/cloudStorage.ts` берёт все ключи как есть)
 * и чтобы данные можно было перенести между приложениями.
 *
 * Хранится в localStorage WebView: на Android Tauri он живёт вместе с данными приложения.
 */

export const KEYS = {
  // Библиотека
  favorites: "bookFavorites", // number[] — id в порядке добавления (старые → новые)
  favoritesOnline: "bookFavoritesOnline.v1",
  readHistory: "readHistory", // [id, страница с 0, всего, unix-секунды][], новые первыми
  searchHistory: "searchHistory", // string[], до 10, новые первыми

  // Внешний вид и интерфейс (components/settings/keys.ts)
  themeHue: "themeHue", // градусы строкой
  language: "app_language",
  fullscreen: "ui_fullscreen",
  infiniteScroll: "ui_infinite_scroll",
  uikitAsHome: "uikit_as_home",
  resetTagsOnBookTagNav: "reset_tags_on_book_tag_nav",
  galleryColumns: "galleryColumns",
  gridConfig: "grid_config_map_v2",

  // Сортировки списков
  sortFavorites: "ui.sort.favorites",
  sortHistory: "ui.sort.history",
  sortDownloaded: "ui.sort.downloaded",
  queryFavoritesOnline: "ui.q.favoritesOnline",

  // Фильтры каталога
  searchSort: "searchSortPref",
  dateRange: "dateRange:v5",
  pagesFilter: "pagesFilterPref:v1",
  tagFilter: "globalTagFilter.v3",
  tagFavorites: "tag.favs.v1",
  tagFavoritesLegacy: "tag.favs",

  // Читалка
  readerHideHints: "reader_hide_hints",

  // Прочее
  savePath: "electron:savePath",
  recommendationCalibration: "recommendation.tagPopularityCalibration.v1",
  cloudDeviceId: "@cloud.deviceId",
  cloudAppVersion: "@cloud.appVersion",
  me: "nh.me",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

/** Событие окна: значение ключа изменилось (detail — ключ). */
export const STORAGE_EVENT = "nhapp-storage";

export function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
  notify(key);
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
  notify(key);
}

/** JSON-значение или `fallback`, если ключа нет или он битый. */
export function getJSON<T>(key: string, fallback: T): T {
  const raw = getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  setItem(key, JSON.stringify(value));
}

/** Все пары ключ–значение (для экспорта и облачной синхронизации). */
export function getAll(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key != null) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    /* хранилище недоступно */
  }
  return out;
}

/** Подписка на изменения: колбэк получает ключ. Возвращает отписку. */
export function subscribe(cb: (key: string) => void): () => void {
  const onLocal = (e: Event) => cb((e as CustomEvent<string>).detail);
  const onOther = (e: StorageEvent) => e.key && cb(e.key);
  window.addEventListener(STORAGE_EVENT, onLocal);
  window.addEventListener("storage", onOther);
  return () => {
    window.removeEventListener(STORAGE_EVENT, onLocal);
    window.removeEventListener("storage", onOther);
  };
}

function notify(key: string) {
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: key }));
}
