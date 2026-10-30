/**
 * Главная и результаты поиска — перенос `app/index.tsx` / `app/explore.tsx` (релиз 1.3.1).
 * Сетка по 25 карточек, внизу панель страниц, при пустом результате — плашка с действиями.
 * Сортировка, язык, страницы и дата берутся из меню фильтров в шапке.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { galleryCardToBook, type Book } from "../api/book";
import { PER_PAGE } from "../api/galleries";
import { fetchGalleryBrowsePaginated, totalFromPaginated } from "../api/galleryBrowse";
import { initCdn } from "../api/media";
import { BookGrid } from "../components/BookGrid";
import { PaginationBar } from "../components/PaginationBar";
import { errorText, useI18n } from "../i18n/I18nContext";
import {
  getPagesQuery,
  getSort,
  getTagFilters,
  getUploaded,
  setSort,
  setUploaded,
  useBrowseFilters,
} from "../lib/browseFilters";
import { rememberCards } from "../lib/bookCards";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { KEYS, getItem, setJSON } from "../lib/storage";
import { Button, LoadingSpinner, NoResultsPanel } from "../ui";

/** Страница каталога с текущими фильтрами; один включённый тег идёт через `/galleries/tagged`. */
function fetchBrowsePage(query: string, page: number) {
  const tags = getTagFilters();
  return fetchGalleryBrowsePaginated({
    query: [query.trim(), getPagesQuery()].filter(Boolean).join(" "),
    includes: tags.filter((f) => f.mode !== "exclude"),
    excludes: tags.filter((f) => f.mode === "exclude"),
    uploaded: getUploaded(),
    sort: getSort(),
    page,
    per_page: PER_PAGE,
  });
}

export function HomeScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useBrowseFilters();
  const query = params.get("query") ?? "";
  const page = Math.max(1, Number(params.get("page") || "1") || 1);

  const [books, setBooks] = useState<Book[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  // Бесконечная прокрутка (ui_infinite_scroll): без панели страниц, следующая страница — у конца списка
  const infinite = getItem(KEYS.infiniteScroll) === "true";
  const [extraPages, setExtraPages] = useState(0);
  const loadingMore = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  // В результатах поиска книги из чёрного списка убираются совсем (strictBlacklistMode), в каталоге — размываются
  const blacklist = useBlacklistSets();
  const strictBlacklist = query.trim().length > 0;
  const visibleBooks = useMemo(
    () => (strictBlacklist ? books.filter((b) => !isBookBlacklisted(b, blacklist)) : books),
    [books, blacklist, strictBlacklist],
  );

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? s : "loading"));
    (async () => {
      try {
        await initCdn();
        const data = await fetchBrowsePage(query, page);
        if (cancelled) return;
        rememberCards(data.result);
        setBooks(data.result.map(galleryCardToBook));
        setExtraPages(0);
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
  }, [query, page, filters, retry]);

  const loadMore = async () => {
    const next = page + extraPages + 1;
    if (!infinite || loadingMore.current || next > totalPages) return;
    loadingMore.current = true;
    try {
      const data = await fetchBrowsePage(query, next);
      rememberCards(data.result);
      setBooks((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...data.result.filter((c) => !seen.has(c.id)).map(galleryCardToBook)];
      });
      setExtraPages((n) => n + 1);
    } catch {
      /* попробуем при следующей прокрутке */
    } finally {
      loadingMore.current = false;
    }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 0.6) void loadMore();
  };

  const goPage = (next: number) => {
    const p = new URLSearchParams(params);
    if (next <= 1) p.delete("page");
    else p.set("page", String(next));
    setParams(p);
    scroller.current?.scrollTo({ top: 0 });
  };

  const openBook = (book: Book) =>
    navigate(`/book/${book.id}?title=${encodeURIComponent(book.title.pretty)}`);

  if (state === "empty" || (state === "ready" && strictBlacklist && books.length > 0 && visibleBooks.length === 0)) {
    const reason = getUploaded() ? "dates" : getTagFilters().length ? "filters" : "general";
    const title =
      reason === "dates"
        ? t("explore.noResults.title.dates")
        : reason === "filters"
          ? t("explore.noResults.title.filters")
          : query.trim()
            ? t("explore.noResults.title.query", { query: query.trim() })
            : t("explore.noResults.title.general");
    const base = [
      { label: t("explore.noResults.actions.openFilters"), onPress: () => navigate("/tags") },
      { label: t("explore.noResults.actions.fresh"), onPress: () => setSort("date") },
      { label: t("explore.noResults.actions.popularMonth"), onPress: () => setSort("popular-month") },
    ];
    const first =
      reason === "dates"
        ? { label: t("explore.noResults.actions.resetDates"), onPress: () => setUploaded(null) }
        : reason === "filters"
          ? { label: t("explore.noResults.actions.resetFilters"), onPress: () => setJSON(KEYS.tagFilter, []) }
          : {
              label: t("explore.noResults.actions.changeQuery"),
              onPress: () => navigate(`/search?query=${encodeURIComponent(query.trim())}`),
            };
    return (
      <div className="screen-fill">
        <NoResultsPanel
          title={title}
          subtitle={t("explore.noResults.subtitle")}
          iconName={reason === "dates" ? "calendar" : reason === "filters" ? "filter" : "search"}
          actions={[first, ...base]}
        />
      </div>
    );
  }

  return (
    <div className="screen-fill">
      <div ref={scroller} className="screen-scroll" onScroll={infinite ? onScroll : undefined}>
        {state === "loading" && books.length === 0 && <LoadingSpinner />}
        {state === "error" && (
          <div className="error-block">
            <p>{errorText(t, error, "errors.catalog")}</p>
            <Button title={t("common.retry")} variant="secondary" compact onPress={() => setRetry((n) => n + 1)} />
          </div>
        )}
        {visibleBooks.length > 0 && state !== "error" && <BookGrid books={visibleBooks} onPress={openBook} />}
      </div>
      {state !== "error" && !infinite && <PaginationBar currentPage={page} totalPages={totalPages} onChange={goPage} />}
    </div>
  );
}
