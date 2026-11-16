/**
 * Лента каталога — новый кит: книги в выбранном виде карточек (`BookCollection`) с бесконечной подгрузкой вместо панели страниц.
 * Следующая страница запрашивается, когда низ списка подходит к экрану (IntersectionObserver).
 * Фильтры (язык, страницы, дата, теги) — общие из `browseFilters`; сортировку задаёт вкладка (`sort`),
 * без неё — сортировка из фильтров (результаты поиска). Каждая лента — со своей вертикальной прокруткой.
 *
 * Первая страница каждой ленты запоминается (в памяти и на устройстве, последние `FIRST_PAGE_KEEP`):
 * при открытии она показывается сразу, а свежая подгружается поверх. Не загрузилось, а запомненное есть —
 * остаётся оно, без экрана ошибки. Ошибка — лента сама пробует снова, когда сеть вернулась или окно снова видно.
 */
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { TabIdContext } from "../browser/tabs";
import { useLocation, useNavigate } from "react-router-dom";
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
import { useStableCallback } from "../lib/useStableCallback";
import { Button, LoadingSpinner, NoResultsPanel, Spinner } from "../ui";
import { AccountNoticeSlot } from "../shell/AccountNotice";
import { BookCollection } from "./BookCollection";

type Paginated = Awaited<ReturnType<typeof fetchGalleryBrowsePaginated>>;

const FIRST_PAGE_KEY = "@local.feed.firstPages.v1";
const FIRST_PAGE_KEEP = 12;

/** Ключ ленты: запрос, сортировка и все фильтры. */
function feedKey(query: string, sort: SortOrder): string {
  return JSON.stringify([query.trim(), sort, getTagFilters(), getPagesQuery(), getUploaded()]);
}

let firstPages: Record<string, { at: number; data: Paginated }> | null = null;
function loadFirstPages() {
  if (!firstPages) {
    try {
      firstPages = JSON.parse(localStorage.getItem(FIRST_PAGE_KEY) || "{}");
    } catch {
      firstPages = {};
    }
  }
  return firstPages!;
}
function cachedFirstPage(key: string): Paginated | null {
  return loadFirstPages()[key]?.data ?? null;
}
function rememberFirstPage(key: string, data: Paginated) {
  const all = loadFirstPages();
  all[key] = { at: Date.now(), data };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(FIRST_PAGE_KEEP)) delete all[k];
  try {
    localStorage.setItem(FIRST_PAGE_KEY, JSON.stringify(all));
  } catch {
    /* место кончилось — останется в памяти */
  }
}

/**
 * Подгруженная лента по записи истории (`location.key` слоя) — вернулись назад на этот экран: та же лента
 * со всеми подгруженными страницами, без запроса, и прокрутка восстанавливается (`Shell.tsx`). Только в памяти.
 */
interface FeedSnapshot {
  books: Book[];
  page: number;
  totalPages: number;
}
const snapshots = new Map<string, FeedSnapshot>();
const SNAPSHOT_KEEP = 24;
function rememberSnapshot(key: string, snap: FeedSnapshot) {
  snapshots.delete(key);
  snapshots.set(key, snap);
  while (snapshots.size > SNAPSHOT_KEEP) snapshots.delete(snapshots.keys().next().value!);
}

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
  // Запись истории этой вкладки (первая у каждой — «default», поэтому с номером вкладки)
  const historyKey = `${useContext(TabIdContext) ?? ""}|${useLocation().key}`;
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
  // Фильтры, с которыми экран открыли: снимок ленты подходит только к ним
  const openedWith = useRef(filters);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const blacklist = useBlacklistSets();
  const strict = query.trim().length > 0;
  const enriched = useEnrichedBooks(books);
  const visible = useMemo(() => (strict ? enriched.filter((b) => !isBookBlacklisted(b, blacklist)) : enriched), [enriched, blacklist, strict]);

  // Первая страница — при смене фильтров, запроса или сортировки. Запомненная — сразу, свежая — поверх
  useEffect(() => {
    let cancelled = false;
    const key = feedKey(query, sort);
    // Вернулись назад к этой записи истории — лента как была, без запроса (только при открытии экрана:
    // смена фильтров дальше грузит заново)
    const snap = retry === 0 && filters === openedWith.current ? snapshots.get(`${historyKey}|${key}`) : undefined;
    if (snap) {
      setBooks(snap.books);
      setPage(snap.page);
      setTotalPages(snap.totalPages);
      setState("ready");
      return;
    }
    const cached = cachedFirstPage(key);
    const show = (data: Paginated) => {
      rememberCards(data.result);
      setBooks(data.result.map(galleryCardToBook));
      setPage(1);
      setTotalPages(Math.max(1, Math.ceil(totalFromPaginated(data) / PER_PAGE)));
      setState(data.result.length ? "ready" : "empty");
    };
    setMoreError(false);
    if (retry === 0) scroller.current?.scrollTo({ top: 0 });
    if (cached?.result.length) show(cached);
    else setState("loading");
    (async () => {
      try {
        // Хосты CDN и страница — параллельно (initCdn почти не ждёт, см. media.ts)
        const [data] = await Promise.all([fetchPage(query, 1, sort), initCdn()]);
        if (cancelled) return;
        rememberFirstPage(key, data);
        // Пока смотрели запомненное, не сбрасываем прокрутку и подгруженное дальше, если первая не поменялась
        if (cached && JSON.stringify(cached.result.map((c) => c.id)) === JSON.stringify(data.result.map((c) => c.id))) return;
        show(data);
      } catch (e) {
        if (cancelled) return;
        if (cached?.result.length) return;
        setError(e);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, sort, filters, retry]);

  // Ошибка — пробуем снова сами: сеть вернулась, окно снова на экране или просто через несколько секунд
  useEffect(() => {
    if (state !== "error") return;
    const again = () => setRetry((n) => n + 1);
    const onVisible = () => document.visibilityState === "visible" && again();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setTimeout(again, 4000);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer);
    };
  }, [state]);

  // Запоминаем подгруженное для этой записи истории
  useEffect(() => {
    if (state === "ready" && books.length) rememberSnapshot(`${historyKey}|${feedKey(query, sort)}`, { books, page, totalPages });
  }, [books, page, totalPages, state]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Следующая страница не пришла — ещё раз сами, кнопка остаётся на всякий случай
      window.setTimeout(() => setMoreError(false), 3000);
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

  const openBook = useStableCallback((book: Book) => navigate(`/book/${book.id}?title=${encodeURIComponent(book.title.pretty)}`));
  const readBook = useStableCallback((book: Book) => navigate(`/read/${book.id}`));

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
      {/* Сессия устарела / нет ключа API — карточка в начале ленты (листается вместе с ней) */}
      <AccountNoticeSlot />
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
