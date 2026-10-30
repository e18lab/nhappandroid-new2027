/**
 * Ранние сборки нового приложения писали свои ключи `nhapp.*` в своём формате.
 * Переносим их в ключи старого приложения и удаляем.
 *
 * `nhapp.history` не переносим: там «открытые книги» без страницы и числа страниц,
 * а `readHistory` — прогресс чтения, который пишет читалка.
 */
import { loadFavoriteIds } from "./library";
import { KEYS, getItem, getJSON, removeItem, setItem, setJSON } from "./storage";

const OLD_FAVORITES = "nhapp.favorites";
const OLD_HISTORY = "nhapp.history";
const OLD_HUE = "nhapp.themeHue";

export function migrateLegacyKeys(): void {
  const oldFavorites = getJSON<unknown>(OLD_FAVORITES, null);
  if (Array.isArray(oldFavorites)) {
    // Был список объектов {id,…}, новые первыми → id от старых к новым, после уже сохранённых.
    const ids = oldFavorites
      .map((b) => Number((b as { id?: unknown })?.id))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse();
    const current = loadFavoriteIds();
    const merged = [...current, ...ids.filter((id) => !current.includes(id))];
    if (merged.length !== current.length) setJSON(KEYS.favorites, merged);
  }
  if (getItem(OLD_FAVORITES) != null) removeItem(OLD_FAVORITES);

  const oldHue = getItem(OLD_HUE);
  if (oldHue != null) {
    if (getItem(KEYS.themeHue) == null) setItem(KEYS.themeHue, oldHue);
    removeItem(OLD_HUE);
  }

  if (getItem(OLD_HISTORY) != null) removeItem(OLD_HISTORY);
}
