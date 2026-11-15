/**
 * Поиск: живые подсказки книг по мере ввода (с задержкой, с учётом фильтров и чёрного списка) и переход
 * к результатам. Общее для поля в заголовке окна (ПК) и страницы поиска (телефон).
 */
import { useEffect, useMemo, useState } from "react";
import { galleryCardToBook, type Book } from "../api/book";
import { listGalleries } from "../api/galleries";
import { initCdn } from "../api/media";
import { isBookBlacklisted, useBlacklistSets } from "./blacklist";
import { buildQuery, getSort, getUploaded, useBrowseFilters } from "./browseFilters";
import { rememberSearch } from "./library";

export const isNumericBookId = (s: string) => /^\d+$/.test(s.trim());

/** Куда ведёт запрос: число — книга, текст — результаты поиска. Запрос запоминается в истории. */
export function searchRoute(text: string): string | null {
  const query = text.trim();
  if (!query) return null;
  rememberSearch(query);
  return isNumericBookId(query) ? `/book/${query}` : `/explore?query=${encodeURIComponent(query)}`;
}

/** Подсказки книг для запроса (до `limit`). С фильтром по дате подсказок нет — API их не умеет. */
export function useSearchSuggest(text: string, limit = 25): { books: Book[]; loading: boolean; dateFilter: boolean } {
  const filters = useBrowseFilters();
  const blacklist = useBlacklistSets();
  const [all, setAll] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = text.trim();
  const dateFilter = !!getUploaded();

  useEffect(() => {
    if (!trimmed || dateFilter || isNumericBookId(trimmed)) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await initCdn();
        const res = await listGalleries(1, getSort(), buildQuery(trimmed));
        if (!cancelled) setAll(res.result.map(galleryCardToBook));
      } catch {
        if (!cancelled) setAll([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, dateFilter, filters]);

  const books = useMemo(() => all.filter((b) => !isBookBlacklisted(b, blacklist)).slice(0, limit), [all, blacklist, limit]);
  return { books, loading, dateFilter };
}
