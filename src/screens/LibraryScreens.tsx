/**
 * Закладки и история — перенос `app/favorites.tsx`, `app/history.tsx`, `components/BookListHistory.tsx`,
 * `components/ListSortBar.tsx`, `app/downloaded.tsx` (релиз 1.3.1).
 *
 * Сверху «N всего» и сортировка (по добавлению / году / алфавиту, ключи `ui.sort.favorites` / `ui.sort.history`).
 * Закладки — сетка карточек. История «новые → старые» — по дням: капсула с датой,
 * над карточкой время и прогресс «12/20» или «✔»; при другой сортировке — обычная сетка.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Book } from "../api/book";
import { initCdn } from "../api/media";
import { BookCard } from "../components/BookCard";
import { BookCollection } from "../components/BookCollection";
import { useGridMetrics } from "../components/BookGrid";
import { useI18n } from "../i18n/I18nContext";
import { cachedCard } from "../lib/bookCards";
import { cachedFullBook, useEnrichedBooks } from "../lib/bookEnrich";
import { listDownloads, useDownloadState, type DownloadedBook } from "../lib/downloads";
import { loadFavoriteIds, loadReadHistory, type ReadProgress } from "../lib/library";
import { KEYS, getItem, setItem, subscribe } from "../lib/storage";
import { FilterDropdown, Icon, LoadingSpinner, type IconName, type SelectItem } from "../ui";

type ListSortValue = "added_desc" | "added_asc" | "year_desc" | "year_asc" | "alpha_asc" | "alpha_desc";
const LIST_SORT_VALUES: ListSortValue[] = ["added_desc", "added_asc", "year_desc", "year_asc", "alpha_asc", "alpha_desc"];

/** Заготовка карточки по id, пока полные данные не догружены (как placeholdersForMissing в старом). */
function placeholderBook(id: number): Book {
  const full = cachedFullBook(id);
  if (full) return full;
  const card = cachedCard(id);
  return {
    id,
    title: { english: card?.title ?? "", japanese: "", pretty: card?.title ?? "" },
    uploaded: "",
    mediaId: "",
    favorites: 0,
    pagesCount: card?.numPages ?? 0,
    scanlator: "",
    tags: [],
    artists: [],
    characters: [],
    parodies: [],
    groups: [],
    categories: [],
    languages: [],
    tagIds: [],
    cover: card?.thumbnail ?? "",
    thumbnail: card?.thumbnail ?? "",
    pages: [],
    full: false,
  };
}

function sortBooks(books: Book[], sort: ListSortValue, addedOrder: number[]): Book[] {
  const idx = new Map(addedOrder.map((id, i) => [id, i]));
  const year = (b: Book) => {
    const d = b.uploaded ? new Date(b.uploaded) : null;
    return d && Number.isFinite(d.getTime()) ? d.getFullYear() : 0;
  };
  const title = (b: Book) => b.title.pretty.toLowerCase();
  const out = [...books];
  switch (sort) {
    case "added_asc":
      return out.sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
    case "added_desc":
      return out.sort((a, b) => (idx.get(b.id) ?? 1e9) - (idx.get(a.id) ?? 1e9));
    case "year_asc":
      return out.sort((a, b) => year(a) - year(b));
    case "year_desc":
      return out.sort((a, b) => year(b) - year(a));
    case "alpha_asc":
      return out.sort((a, b) => title(a).localeCompare(title(b)));
    case "alpha_desc":
      return out.sort((a, b) => title(b).localeCompare(title(a)));
  }
}

function useSort(key: string): [ListSortValue, (v: ListSortValue) => void] {
  const [sort, setSortState] = useState<ListSortValue>(() => {
    const v = getItem(key) as ListSortValue | null;
    return v && LIST_SORT_VALUES.includes(v) ? v : "added_desc";
  });
  return [
    sort,
    (v) => {
      setSortState(v);
      setItem(key, v);
    },
  ];
}

/** Строка «N всего» + кнопка сортировки — ListSortBar. */
function ListSortBar({ count, sort, onChange }: { count: number; sort: ListSortValue; onChange: (v: ListSortValue) => void }) {
  const { t } = useI18n();
  const options: SelectItem[] = [
    {
      type: "submenu",
      label: t("listSort.byAdded"),
      children: [
        { value: "added_desc", label: t("listSort.newToOld") },
        { value: "added_asc", label: t("listSort.oldToNew") },
      ],
    },
    {
      type: "submenu",
      label: t("listSort.byYear"),
      children: [
        { value: "year_desc", label: t("listSort.newToOld") },
        { value: "year_asc", label: t("listSort.oldToNew") },
      ],
    },
    {
      type: "submenu",
      label: t("listSort.byAlpha"),
      children: [
        { value: "alpha_asc", label: t("listSort.az") },
        { value: "alpha_desc", label: t("listSort.za") },
      ],
    },
  ];
  const group = sort.startsWith("added_") ? "listSort.byAdded" : sort.startsWith("year_") ? "listSort.byYear" : "listSort.byAlpha";
  const icon: IconName = sort.startsWith("added_") ? "sliders" : sort.startsWith("year_") ? "calendar" : "type";

  return (
    <div className="list-sort-bar">
      <span className="list-sort-count">{t("listSort.totalCount", { count })}</span>
      <FilterDropdown
        value={sort}
        options={options}
        onChange={(v) => onChange(v as ListSortValue)}
        trigger={({ open, onPress }) => (
          <button type="button" className="list-sort-btn" onClick={onPress}>
            <Icon name={icon} size={16} />
            <span>{t(group)}</span>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
          </button>
        )}
      />
    </div>
  );
}

export function SavedScreen({ kind }: { kind: "favorites" | "history" }) {
  const { t, resolved } = useI18n();
  const navigate = useNavigate();
  const [sort, setSort] = useSort(kind === "favorites" ? KEYS.sortFavorites : KEYS.sortHistory);
  const [ids, setIds] = useState<number[]>([]);
  const [history, setHistory] = useState<ReadProgress[]>([]);
  const [cdnReady, setCdnReady] = useState(false);

  useEffect(() => {
    void initCdn().then(() => setCdnReady(true));
    const key = kind === "favorites" ? KEYS.favorites : KEYS.readHistory;
    const load = () => {
      if (kind === "favorites") setIds(loadFavoriteIds());
      else {
        const h = loadReadHistory();
        setHistory(h);
        setIds(h.map((e) => e.id));
      }
    };
    load();
    return subscribe((changed) => changed === key && load());
  }, [kind]);

  const base = useMemo(() => ids.map(placeholderBook), [ids]);
  const books = useEnrichedBooks(base);
  // Порядок «по добавлению»: закладки хранятся от старых к новым, история — новые первыми
  const addedOrder = kind === "favorites" ? ids : [...ids].reverse();
  const sorted = useMemo(() => sortBooks(books, sort, addedOrder), [books, sort, ids]);
  const open = (b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`);

  const empty = ids.length === 0;
  const emptyText = kind === "favorites" ? t("library.favoritesEmpty") : t("historyNotFound");

  return (
    <div className="screen-fill library-screen">
      <div className="screen-scroll">
        <div className="library-head">
          <ListSortBar count={sorted.length} sort={sort} onChange={setSort} />
        </div>
        {empty ? (
          <p className="library-empty">{emptyText}</p>
        ) : !cdnReady ? (
          <LoadingSpinner />
        ) : kind === "history" && sort === "added_desc" ? (
          <HistorySections books={books} history={history} locale={resolved} onPress={open} />
        ) : (
          <BookCollection books={sorted} onPress={open} />
        )}
      </div>
    </div>
  );
}

/**
 * Загруженное — `app/downloaded.tsx`: скачанные книги с устройства (обложка — первая страница),
 * сортировка `ui.sort.downloaded`, «по добавлению» — по времени скачивания. Пока книга качается,
 * она первой карточкой в списке; по окончании список перечитывается.
 */
export function DownloadedScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [sort, setSort] = useSort(KEYS.sortDownloaded);
  const [books, setBooks] = useState<DownloadedBook[]>([]);
  const [pending, setPending] = useState(true);
  const dl = useDownloadState();

  useEffect(() => {
    let alive = true;
    listDownloads()
      .then((list) => alive && setBooks(list))
      .catch(() => alive && setBooks([]))
      .finally(() => alive && setPending(false));
    return () => {
      alive = false;
    };
  }, [dl.lastFinishedAt]);

  // «По добавлению» = время скачивания: список приходит новыми первыми
  const addedOrder = useMemo(() => [...books].sort((a, b) => a.downloadedAt - b.downloadedAt).map((b) => b.id), [books]);
  const sorted = useMemo(() => sortBooks(books, sort, addedOrder), [books, sort, addedOrder]);
  const downloadingCard: Book[] =
    dl.active && dl.bookId && !books.some((b) => b.id === dl.bookId)
      ? [{ ...placeholderBook(dl.bookId), id: -dl.bookId, full: true, title: { english: "", japanese: "", pretty: dl.title || t("downloads.downloading") }, cover: dl.cover ?? "", thumbnail: dl.cover ?? "" }]
      : [];
  const shown = [...downloadingCard, ...sorted];
  // Карточка загрузки (отрицательный id) не открывается, как в старом
  const open = (b: Book) => b.id > 0 && navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`);

  return (
    <div className="screen-fill library-screen">
      <div className="screen-scroll">
        <div className="library-head">
          <ListSortBar count={shown.length} sort={sort} onChange={setSort} />
        </div>
        {pending ? (
          <LoadingSpinner />
        ) : shown.length === 0 ? (
          <p className="library-empty">{t("downloaded.noHaveADownloadBook")}</p>
        ) : (
          <BookCollection books={shown} onPress={open} />
        )}
      </div>
    </div>
  );
}

/** История по дням (BookListHistory): капсула даты, над карточкой время и прогресс. */
function HistorySections({
  books,
  history,
  locale,
  onPress,
}: {
  books: Book[];
  history: ReadProgress[];
  locale: string;
  onPress: (b: Book) => void;
}) {
  const { host, ready, cardWidth, pad, gap } = useGridMetrics();
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const sections = useMemo(() => {
    const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: locale === "en" ? "numeric" : "2-digit", minute: "2-digit", hour12: locale === "en" });
    const groups = new Map<string, { title: string; items: { book: Book; entry: ReadProgress; time: string }[] }>();
    for (const entry of [...history].sort((a, b) => b.ts - a.ts)) {
      const book = byId.get(entry.id);
      if (!book || !entry.ts) continue;
      const d = new Date(entry.ts * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups.has(key)) {
        const parts = dateFmt.formatToParts(d);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
        groups.set(key, { title: `${get("day")} ${get("month")} ${get("year")}`, items: [] });
      }
      groups.get(key)!.items.push({ book, entry, time: timeFmt.format(d) });
    }
    return [...groups.entries()].sort((a, b) => (a[0] > b[0] ? -1 : 1));
  }, [history, byId, locale]);

  return (
    <div ref={host} className="history-sections" style={{ paddingTop: pad / 2 }}>
      {ready &&
        sections.map(([key, sec]) => (
          <div key={key}>
            <div className="history-day" style={{ padding: `8px ${pad}px 6px` }}>
              <span>{sec.title}</span>
            </div>
            <div className="history-row" style={{ padding: `0 ${pad}px`, gap }}>
              {sec.items.map(({ book, entry, time }) => {
                const done = entry.current >= entry.total - 1;
                return (
                  <div key={`${book.id}-${entry.ts}`} style={{ width: cardWidth }}>
                    <div className="history-time-row">
                      <span className="history-time">{time}</span>
                      <span className={done ? "history-progress is-done" : "history-progress"}>
                        {done ? "✔" : `${Math.min(entry.current + 1, entry.total)}/${entry.total}`}
                      </span>
                    </div>
                    <BookCard book={book} cardWidth={cardWidth} onPress={onPress} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

export function NoteScreen({ titleKey, textKey }: { titleKey: string; textKey: string }) {
  const { t } = useI18n();
  return (
    <div className="screen">
      <h1 className="screen-title">{t(titleKey)}</h1>
      <div className="status-card">
        <p>{t(textKey)}</p>
      </div>
    </div>
  );
}
