/**
 * Онлайн-избранное nhentai — перенос `app/favoritesOnline.tsx` и `components/BookListOnline.tsx` (релиз 1.3.1).
 *
 * Сверху «N всего», поиск по избранному (`ui.q.favoritesOnline`) и кнопка панели действий:
 * импорт из локальных закладок и выбор книг для удаления. Удалённые можно вернуть кнопкой «Отменить».
 * Сетка — карточки каталога, внизу пагинация (или бесконечная прокрутка, как в каталоге).
 * Фоновый авто-импорт старого приложения переносится вместе с сервисными функциями (этап 10).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFavorites } from "../api/account";
import { galleryCardToBook, type Book } from "../api/book";
import { PER_PAGE } from "../api/galleries";
import { initCdn } from "../api/media";
import { BookCard } from "../components/BookCard";
import { useGridMetrics } from "../components/BookGrid";
import { PaginationBar } from "../components/PaginationBar";
import { errorText, useI18n } from "../i18n/I18nContext";
import { rememberCards, cachedCard } from "../lib/bookCards";
import { cachedFullBook, useEnrichedBooks } from "../lib/bookEnrich";
import { loadFavoriteIds } from "../lib/library";
import { addOnlineFavoriteIds, bulkSetFavorites, readOnlineFavoriteIds } from "../lib/onlineFavorites";
import { useMe } from "../lib/session";
import { KEYS, getItem, setItem } from "../lib/storage";
import { Button, Icon, LoadingSpinner, NhModal, Spinner, useToast } from "../ui";

const Q_KEY = "ui.q.favoritesOnline";

export function FavoritesOnlineScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const me = useMe();
  const infinite = getItem(KEYS.infiniteScroll) === "true";

  const [q, setQ] = useState(() => getItem(Q_KEY) ?? "");
  const [query, setQuery] = useState(q.trim());
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [books, setBooks] = useState<Book[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [toolbar, setToolbar] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<Book[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const loadingMore = useRef(false);
  /** Последняя загруженная страница при бесконечной прокрутке. */
  const loadedPage = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const { host, ready, cardWidth, pad, gap } = useGridMetrics();
  const enriched = useEnrichedBooks(books);

  // Поиск с задержкой 250 мс, запрос запоминается
  useEffect(() => {
    setItem(Q_KEY, q);
    const h = window.setTimeout(() => setQuery(q.trim()), 250);
    return () => window.clearTimeout(h);
  }, [q]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    setState((s) => (s === "ready" ? s : "loading"));
    (async () => {
      try {
        await initCdn();
        const res = await getFavorites({ q: query || undefined, page, per_page: PER_PAGE });
        if (cancelled) return;
        rememberCards(res.result);
        addOnlineFavoriteIds(res.result.map((c) => c.id));
        setBooks(res.result.map(galleryCardToBook));
        loadedPage.current = page;
        setTotal(res.total || 0);
        setTotalPages(Math.max(1, res.num_pages));
        setState("ready");
        scroller.current?.scrollTo({ top: 0 });
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, query, page, retry]);

  const loadMore = async () => {
    if (!infinite || loadingMore.current || loadedPage.current >= totalPages) return;
    loadingMore.current = true;
    try {
      const next = loadedPage.current + 1;
      const res = await getFavorites({ q: query || undefined, page: next, per_page: PER_PAGE });
      rememberCards(res.result);
      setBooks((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...res.result.filter((c) => !seen.has(c.id)).map(galleryCardToBook)];
      });
      loadedPage.current = next;
      setTotalPages(Math.max(1, res.num_pages));
    } catch {
      /* попробуем при следующей прокрутке */
    } finally {
      loadingMore.current = false;
    }
  };

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runDelete = async () => {
    const ids = [...selected];
    setConfirmDelete(false);
    setSelectMode(false);
    setSelected(new Set());
    if (!ids.length) return;
    const removed = books.filter((b) => ids.includes(b.id));
    setBooks((prev) => prev.filter((b) => !ids.includes(b.id)));
    setTotal((n) => Math.max(0, n - ids.length));
    setUndo((prev) => [...removed, ...prev]);
    await bulkSetFavorites(ids, false);
  };

  const runUndo = async () => {
    const restore = undo;
    setUndo([]);
    await bulkSetFavorites(
      restore.map((b) => b.id),
      true,
    );
    setBooks((prev) => {
      const seen = new Set(prev.map((b) => b.id));
      return [...restore.filter((b) => !seen.has(b.id)), ...prev];
    });
    setTotal((n) => n + restore.length);
  };

  if (!me) {
    return (
      <div className="screen-fill fo-empty">
        <Icon name="lock" size={40} />
        <p>{t("notes.favoritesOnline")}</p>
      </div>
    );
  }

  return (
    <div className="screen-fill fo-screen">
      <div
        ref={scroller}
        className="screen-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (infinite && el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 0.6) void loadMore();
        }}
      >
        <div className="fo-header">
          <span className="list-sort-count">{total ? t("listSort.totalCount", { count: total }) : ""}</span>
          <label className="fo-search">
            <Icon name="search" size={16} />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder={t("favoritesOnline.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="search"
            />
          </label>
          <button type="button" className={toolbar ? "fo-pill is-active" : "fo-pill"} onClick={() => setToolbar((v) => !v)}>
            <Icon name="sliders" size={16} />
          </button>
        </div>

        {toolbar && (
          <div className="fo-toolbar">
            <button type="button" className="fo-tool is-accent" onClick={() => setImportOpen(true)}>
              <Icon name="upload" size={14} />
              {t("favorites.import.button")}
            </button>
            {!selectMode ? (
              <button type="button" className="fo-tool" onClick={() => setSelectMode(true)}>
                <Icon name="check-square" size={14} />
                {t("favorites.selectForDelete")}
              </button>
            ) : (
              <button
                type="button"
                className="fo-tool"
                onClick={() => {
                  setSelectMode(false);
                  setSelected(new Set());
                }}
              >
                <Icon name="x" size={14} />
                {t("common.cancelSelection")}
              </button>
            )}
          </div>
        )}

        {state === "loading" && books.length === 0 && <LoadingSpinner />}
        {state === "error" && (
          <div className="error-block">
            <p>{errorText(t, error, "errors.catalog")}</p>
            <Button title={t("common.retry")} variant="secondary" compact onPress={() => setRetry((n) => n + 1)} />
          </div>
        )}
        {state === "ready" && books.length === 0 && <p className="fo-none">{t("booklist.notFoundShort")}</p>}

        <div ref={host} className="book-grid" style={{ padding: `${pad / 2}px ${pad}px`, gap }}>
          {ready &&
            state !== "error" &&
            enriched.map((b) => {
              const isSel = selected.has(b.id);
              return (
                <div key={b.id} className="fo-cell">
                  <BookCard
                    book={b}
                    cardWidth={cardWidth}
                    onPress={() =>
                      selectMode ? toggleSelect(b.id) : navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`)
                    }
                  />
                  {selectMode && (
                    <button
                      type="button"
                      className={isSel ? "fo-select is-selected" : "fo-select"}
                      aria-label={t(isSel ? "favorites.accessibility.deselect" : "favorites.accessibility.select")}
                      onClick={() => toggleSelect(b.id)}
                    >
                      {isSel && (
                        <span className="fo-select-badge">
                          <Icon name="check" size={16} />
                          {t("favorites.selected")}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {undo.length > 0 && (
        <div className={selectMode ? "fo-float is-raised" : "fo-float"}>
          <span>{t("favorites.deletedCount", { count: undo.length })}</span>
          <button type="button" className="is-accent" onClick={() => void runUndo()}>
            <Icon name="rotate-ccw" size={14} />
            {t("common.undo")}
          </button>
          <button type="button" onClick={() => setUndo([])}>
            <Icon name="x" size={14} />
            {t("common.hide")}
          </button>
        </div>
      )}

      {selectMode ? (
        <div className="fo-selection">
          <span>{t("favorites.selectedCount", { count: selected.size })}</span>
          <button
            type="button"
            onClick={() => {
              setSelectMode(false);
              setSelected(new Set());
            }}
          >
            <Icon name="x" size={16} />
            {t("common.cancelSelection")}
          </button>
          <button type="button" className="is-accent" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash-2" size={16} />
            {t("common.delete")}
          </button>
        </div>
      ) : (
        !infinite && <PaginationBar currentPage={page} totalPages={totalPages} onChange={setPage} />
      )}

      <NhModal visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("favorites.deleteOnline.title")}>
        <div className="fo-confirm">
          <p>{t("favorites.deleteOnline.message", { count: selected.size })}</p>
          <div>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="is-accent" onClick={() => void runDelete()}>
              {t("common.delete")}
            </button>
          </div>
        </div>
      </NhModal>

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={(count, failed) => {
            setImportOpen(false);
            showToast({
              type: failed ? "error" : "success",
              title: t("favorites.import.doneTitle"),
              message: failed ? t("favorites.import.partialFail") : t("favorites.import.doneMessage", { count }),
            });
            setRetry((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/** Импорт локальных закладок в онлайн-избранное: список с поиском, «выбрать всё / снять всё». */
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (count: number, failed: number) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);

  // Новые закладки сверху; уже добавленные онлайн не показываем
  const local = useMemo(() => {
    const online = new Set(readOnlineFavoriteIds());
    return loadFavoriteIds()
      .slice()
      .reverse()
      .filter((id) => !online.has(id))
      .map((id) => ({ id, title: cachedFullBook(id)?.title.pretty || cachedCard(id)?.title || "" }));
  }, []);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(local.map((b) => b.id)));

  const needle = query.trim().toLowerCase();
  const shown = needle ? local.filter((b) => b.title.toLowerCase().includes(needle) || String(b.id).includes(needle)) : local;

  const run = async () => {
    const ids = local.filter((b) => selected.has(b.id)).map((b) => b.id);
    if (!ids.length) return;
    setBusy({ done: 0, total: ids.length });
    const failed = await bulkSetFavorites(ids, true, (done, total) => setBusy({ done, total }));
    onDone(ids.length - failed.length, failed.length);
  };

  return (
    <NhModal visible onClose={busy ? () => undefined : onClose} sizing="fixed" title={t("favorites.import.modalTitle")}>
      <div className="fo-import">
        {local.length === 0 ? (
          <p className="fo-none">{t("favorites.import.noLocal")}</p>
        ) : (
          <>
            <div className="fo-import-controls">
              <label className="fo-search">
                <Icon name="search" size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.searchPlaceholder")} />
              </label>
              <button type="button" className="fo-tool" onClick={() => setSelected(new Set(shown.map((b) => b.id)))}>
                {t("common.selectAll")}
              </button>
              <button type="button" className="fo-tool" onClick={() => setSelected(new Set())}>
                {t("common.clearSelection")}
              </button>
            </div>
            <div className="fo-import-list">
              {shown.map((b) => (
                <label key={b.id} className="fo-import-row">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.id)) next.delete(b.id);
                        else next.add(b.id);
                        return next;
                      })
                    }
                  />
                  <span className="fo-import-id">#{b.id}</span>
                  <span className="fo-import-title">{b.title}</span>
                </label>
              ))}
            </div>
            <button type="button" className="fo-import-run" disabled={!!busy || selected.size === 0} onClick={() => void run()}>
              {busy ? (
                <>
                  <Spinner size={16} />
                  {busy.done} / {busy.total}
                </>
              ) : (
                t("favorites.import.importSelected", { count: selected.size })
              )}
            </button>
          </>
        )}
      </div>
    </NhModal>
  );
}
