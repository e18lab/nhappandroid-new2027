/**
 * Лента каталога — новый кит: книги в выбранном виде карточек (`BookCollection`) с бесконечной подгрузкой вместо панели страниц.
 * Следующая страница запрашивается, когда низ списка подходит к экрану (IntersectionObserver).
 * Фильтры (язык, страницы, дата, теги) — общие из `browseFilters`; сортировку задаёт вкладка (`sort`),
 * без неё — сортировка из фильтров (результаты поиска). Каждая лента — со своей вертикальной прокруткой.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { galleryCardToBook, type Book } from "../api/book";
import { PER_PAGE } from "../api/galleries";
import { fetchGalleryBrowsePaginated, totalFromPaginated } from "../api/galleryBrowse";
import { initCdn } from "../api/media";
import type { SortOrder } from "../api/types";
import { errorText, useI18n } from "../i18n/I18nContext";
import { useEnrichedBooks } from "../lib/bookEnrich";
import { rememberCards } from "../lib/bookCards";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { getPagesQuery, getSort, getTagFilters, getUploaded, setSort, setUploaded, useBrowseFilters } from "../lib/browseFilters";
import { KEYS, setJSON } from "../lib/storage";
import { Button, LoadingSpinner, NoResultsPanel, Spinner } from "../ui";
import { BookCollection } from "./BookCollection";

function fetchPage(query: string, page: number, sort: SortOrder) {
  const tags = getTagFilters();
  return fetchGalleryBrowsePaginated({
    query: [query.trim(), getPagesQuery()].filter(Boolean).join(" "),
    includes: tags.filter((f) => f.mode !== "exclude"),
    excludes: tags.filter((f) => f.mode === "exclude"),
    uploaded: getUploaded(),
    sort,
    page,
    per_page: PER_PAGE,
  });
}

export function CatalogFeed({ query = "", sort: fixedSort }: { query?: string; sort?: SortOrder }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const filters = useBrowseFilters();
  const sort = fixedSort ?? getSort();

  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [moreError, setMoreError] = useState(false);
  const loadingMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const blacklist = useBlacklistSets();
  const strict = query.trim().length > 0;
  const enriched = useEnrichedBooks(books);
  const visible = useMemo(() => (strict ? enriched.filter((b) => !isBookBlacklisted(b, blacklist)) : enriched), [enriched, blacklist, strict]);

  // Первая страница — при смене фильтров, запроса или сортировки
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setMoreError(false);
    scroller.current?.scrollTo({ top: 0 });
    (async () => {
      try {
        await initCdn();
        const data = await fetchPage(query, 1, sort);
        if (cancelled) return;
        rememberCards(data.result);
        setBooks(data.result.map(galleryCardToBook));
        setPage(1);
        setTotalPages(Math.max(1, Math.ceil(totalFromPaginated(data) / PER_PAGE)));
        setState(data.result.length ? "ready" : "empty");
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, sort, filters, retry]);

  const hasMore = state === "ready" && page < totalPages;

  const loadMore = async () => {
    if (!hasMore || loadingMore.current) return;
    loadingMore.current = true;
    setMoreError(false);
    try {
      const next = page + 1;
      const data = await fetchPage(query, next, sort);
      rememberCards(data.result);
      setBooks((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...data.result.filter((c) => !seen.has(c.id)).map(galleryCardToBook)];
      });
      setPage(next);
    } catch {
      setMoreError(true);
    } finally {
      loadingMore.current = false;
    }
  };

  // Низ списка близко к экрану — следующая страница
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || moreError) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), {
      root: scroller.current,
      rootMargin: "0px 0px 1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
    // loadMore читает актуальные page/books через замыкание текущего рендера
  });

  const openBook = (book: Book) => navigate(`/book/${book.id}?title=${encodeURIComponent(book.title.pretty)}`);
  const readBook = (book: Book) => navigate(`/read/${book.id}`);

  if (state === "empty" || (state === "ready" && strict && books.length > 0 && visible.length === 0)) {
    const reason = getUploaded() ? "dates" : getTagFilters().length ? "filters" : "general";
    const title =
      reason === "dates"
        ? t("explore.noResults.title.dates")
        : reason === "filters"
          ? t("explore.noResults.title.filters")
          : query.trim()
            ? t("explore.noResults.title.query", { query: query.trim() })
            : t("explore.noResults.title.general");
    const first =
      reason === "dates"
        ? { label: t("explore.noResults.actions.resetDates"), onPress: () => setUploaded(null) }
        : reason === "filters"
          ? { label: t("explore.noResults.actions.resetFilters"), onPress: () => setJSON(KEYS.tagFilter, []) }
          : { label: t("explore.noResults.actions.changeQuery"), onPress: () => navigate(`/search?query=${encodeURIComponent(query.trim())}`) };
    return (
      <div className="screen-fill">
        <NoResultsPanel
          title={title}
          subtitle={t("explore.noResults.subtitle")}
          iconName={reason === "dates" ? "calendar" : reason === "filters" ? "filter" : "search"}
          actions={[
            first,
            { label: t("explore.noResults.actions.openFilters"), onPress: () => navigate("/tags") },
            ...(fixedSort ? [] : [{ label: t("explore.noResults.actions.fresh"), onPress: () => setSort("date") }]),
          ]}
        />
      </div>
    );
  }

  return (
    <div ref={scroller} className="screen-scroll ax-feed">
      {state === "loading" && <LoadingSpinner />}
      {state === "error" && (
        <div className="error-block">
          <p>{errorText(t, error, "errors.catalog")}</p>
          <Button title={t("common.retry")} variant="secondary" compact onPress={() => setRetry((n) => n + 1)} />
        </div>
      )}
      {state === "ready" && (
        <>
          <BookCollection books={visible} enrich={false} onPress={openBook} onRead={readBook} />
          <div ref={sentinel} className="ax-feed-foot">
            {moreError ? (
              <Button title={t("common.retry")} variant="secondary" compact onPress={() => void loadMore()} />
            ) : hasMore ? (
              <Spinner size={22} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
