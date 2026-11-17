/**
 * «Для вас» — рекомендации как на главной YouTube: полки с горизонтальной прокруткой
 * (продолжить, потому что вы читали «…», художник, теги, пародия, годы, свежее, открытия),
 * под ними — бесконечная лента «Ваш микс». Всё считает сервер (`lib/forYou.ts`), за доли секунды.
 *
 * Сервер недоступен — старые рекомендации на устройстве (`RecommendationsScreen`), чтобы вкладка не пустела.
 * «Ещё» у полки открывает её целиком (`/foryou/:shelf`). «Не интересно» — в меню книги: книга сразу пропадает.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTabActive } from "../browser/tabs";
import { avatarUrl } from "../components/CommentCard";
import { useMl } from "../lib/mlid";
import { useMe } from "../lib/session";
import { useBrowseFilters } from "../lib/browseFilters";
import type { Book } from "../api/book";
import { thumbSources } from "../api/media";
import { SmartImage } from "../components/SmartImage";
import { BookCard } from "../components/BookCard";
import { BookCollection, PosterCard } from "../components/BookCollection";
import { useGridMetrics } from "../components/BookGrid";
import { useI18n } from "../i18n/I18nContext";
import { useCardView } from "../lib/cardView";
import { loadForYou, loadPicks, loadShelfPage, useHiddenFromRecommendations, type PicksTarget, type Shelf } from "../lib/forYou";
import { useTagLabel } from "../lib/tagTranslations";
import { useBookTitle } from "../lib/titleTranslations";
import { useStableCallback } from "../lib/useStableCallback";
import { Button, Icon, LoadingSpinner, Spinner } from "../ui";
import { usePullToRefresh } from "../ui/PullToRefresh";
import { RecommendationsScreen } from "./RecommendationsScreen";

/**
 * Расчёт держим между заходами на вкладку: вернулись — полки и прокрутка на месте.
 * Ключ — аккаунт nhentai и язык: у вкладок браузера разные аккаунты, и выдача у каждого своя.
 */
const cache = new Map<string, { at: number; shelves: Shelf[] }>();
const STALE_MS = 15 * 60_000;
/** Последний показанный расчёт — для «Ещё» (`/foryou/:shelf`). */
let lastShown: { who: string; shelves: Shelf[] } | null = null;

/** Чей расчёт: аккаунт nhentai, под которым сейчас клиент (у вкладки браузера — свой). */
export function useRecoWho(): string {
  const me = useMe();
  // Выбранные теги каталога тоже входят в расчёт: сменили фильтры — подборки свои (и кэш свой)
  const filters = useBrowseFilters();
  return `${me ? `nh:${me.id}` : "guest"}|${filters}`;
}

function useShelfTitle() {
  const { t } = useI18n();
  const tagLabel = useTagLabel();
  return (s: Shelf, seedTitle: string) => {
    const p = s.title.params ?? {};
    const name = p.name != null ? tagLabel(String(p.type ?? "tag"), String(p.name)) : "";
    return t(`foryou.shelf.${s.title.key}`, { name, year: p.year ?? "", to: p.to ?? "", book: seedTitle });
  };
}

/** Полка: карточки того же вида и размера, что в сетке каталога (Настройки → Карточки и сетка). */
export function ShelfRow({ shelf, onOpen, cardWidth, kicker }: { shelf: Shelf; onOpen: (b: Book) => void; cardWidth: number; kicker?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { view, show } = useCardView();
  const title = useShelfTitle();
  const seedTitle = useBookTitle(shelf.seed ?? { id: 0, title: { english: "", japanese: "", pretty: "" } });
  const hidden = useHiddenFromRecommendations();
  const books = shelf.books.filter((b) => !hidden.has(b.id));
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const onScroll = () => {
    const el = row.current;
    if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  };
  useEffect(onScroll, [books.length]);
  // Ширина окна поменялась — края тоже
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: "smooth" });
  if (!books.length) return null;

  return (
    <section className={`fy-shelf is-${shelf.kind}`}>
      <header className="fy-head">
        {shelf.kind === "because" && shelf.seed && (
          <span className="fy-head-seed" aria-hidden>
            <SmartImage sources={thumbSources(shelf.seed.cover)} />
          </span>
        )}
        <div className="fy-head-text">
          {shelf.kind === "because" && <span className="fy-head-kicker">{t("foryou.becauseKicker")}</span>}
          {kicker && <span className="fy-head-kicker is-accent">{kicker}</span>}
          <h2>{shelf.kind === "because" ? seedTitle : title(shelf, seedTitle)}</h2>
        </div>
        <div className="fy-head-actions">
          <button type="button" className="fy-arrow" disabled={edge.start} onClick={() => step(-1)} aria-label="‹">
            <Icon name="chevron-left" size={18} />
          </button>
          <button type="button" className="fy-arrow" disabled={edge.end} onClick={() => step(1)} aria-label="›">
            <Icon name="chevron-right" size={18} />
          </button>
          {shelf.more && (
            <button type="button" className="fy-more" onClick={() => navigate(`/foryou/${encodeURIComponent(shelf.id)}?title=${encodeURIComponent(shelf.kind === "because" ? `${t("foryou.becauseKicker")} «${seedTitle}»` : title(shelf, seedTitle))}`)}>
              {t("foryou.more")}
            </button>
          )}
        </div>
      </header>
      {/* Затенение у края, за которым ещё есть карточки */}
      <div ref={row} className={`fy-row${edge.start ? "" : " has-prev"}${edge.end ? "" : " has-next"}`} onScroll={onScroll}>
        {books.map((b) => {
          const pr = shelf.progress?.[b.id];
          return (
            <div key={b.id} className="fy-item">
              {view === "classic" ? <BookCard book={b} cardWidth={cardWidth} onPress={onOpen} /> : <PosterCard book={b} show={show} onPress={onOpen} />}
              {pr && (
                <span className="fy-progress" title={`${pr[0] + 1} / ${pr[1]}`}>
                  <span style={{ width: `${Math.min(100, ((pr[0] + 1) / Math.max(1, pr[1])) * 100)}%` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Приветствие сверху: аватар и имя (аккаунт nhentai вкладки, без входа — MoeLibre), «доброе утро / день / вечер / ночи»
 * по местному времени и сколько подборок собрано.
 */
function Greeting({ count, loading, onRefresh }: { count: number; loading: boolean; onRefresh: () => void }) {
  const { t } = useI18n();
  const ml = useMl();
  const me = useMe();
  // Аккаунт nhentai вкладки (подборки считаются по нему); без входа — аккаунт MoeLibre
  const name = me?.username || ml.account?.display_name || "";
  const avatar = me ? (me.avatar_url ? avatarUrl(me.avatar_url) : "") : ml.account?.avatar_url || "";
  const h = new Date().getHours();
  const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "day" : h >= 18 && h < 23 ? "evening" : "night";
  return (
    <div className="fy-hello">
      <span className="fy-hello-ava">
        {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : name ? name.charAt(0).toUpperCase() : <Icon name="user" size={26} />}
      </span>
      <div className="fy-hello-text">
        <h1>{name ? t(`foryou.greet.${part}`, { name }) : t(`foryou.greetAnon.${part}`)}</h1>
        <span>{count > 0 ? t("foryou.picked", { count }) : t("foryou.subtitle")}</span>
      </div>
      <button type="button" className="fy-refresh" aria-label={t("recommendations.refresh")} title={t("recommendations.refresh")} disabled={loading} onClick={onRefresh}>
        {loading ? <Spinner size={16} /> : <Icon name="refresh-cw" size={18} />}
      </button>
    </div>
  );
}

/** Подборки к месту: id полки `book:<id>` (под книгой) или `search:<запрос>` (сверху поиска). */
function picksTarget(id: string): PicksTarget | null {
  if (id.startsWith("book:")) return { kind: "book", book: Number(id.slice(5)) };
  if (id.startsWith("search:")) return { kind: "search", query: id.slice(7) };
  return null;
}

/**
 * «Для вас» на чужом экране: под книгой — похожее под ваш вкус, сверху поиска — книги по запросу под ваш вкус.
 * Полка как в «Для вас» (карточки размером с сетку каталога), «Ещё» открывает всю подборку лентой.
 * Мало книг (поиск по редкому запросу) — полки нет.
 */
export function PicksShelf({ target, min = 6, className, pad, kicker }: { target: PicksTarget; min?: number; className?: string; pad?: number; kicker?: string }) {
  const { resolved } = useI18n();
  const who = useRecoWho();
  const navigate = useNavigate();
  const grid = useGridMetrics();
  const id = target.kind === "book" ? `book:${target.book}` : `search:${target.query.trim().toLowerCase()}`;
  const [shelf, setShelf] = useState<Shelf | null>(null);
  useEffect(() => {
    let cancelled = false;
    setShelf(null);
    loadPicks(resolved, who, target, 0, 24)
      .then((r) => {
        if (cancelled || r.books.length < min) return;
        const tag = r.tag;
        setShelf({
          id,
          kind: target.kind === "book" ? "artist" : "tag",
          title: target.kind === "book" ? { key: "picksBook" } : { key: "picksSearch", params: { type: tag?.type ?? "tag", name: tag?.name ?? target.query } },
          books: r.books,
          total: r.total,
          more: r.next != null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, who, resolved]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useStableCallback((b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`));
  // Поля по краям: как у сетки экрана (поиск) или заданные (страница книги — у неё свои поля)
  const vars = { "--fy-w": `${grid.cardWidth}px`, "--fy-gap": `${grid.gap}px`, "--fy-pad": `${pad ?? grid.pad}px` } as CSSProperties;
  return (
    <div className={`fy fy-embed${className ? ` ${className}` : ""}`} style={vars}>
      <div ref={grid.host} className="fy-measure" />
      {shelf && <ShelfRow shelf={shelf} onOpen={open} cardWidth={grid.cardWidth} kicker={kicker} />}
    </div>
  );
}

/** Бесконечная лента полки (микс внизу «Для вас» и «Ещё» у любой полки). */
function useShelfFeed(shelfId: string | null, who: string, first: Book[], total: number, active: boolean) {
  const { resolved } = useI18n();
  const [books, setBooks] = useState<Book[]>(first);
  const [next, setNext] = useState<number | null>(first.length < total ? first.length : null);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    setBooks(first);
    setNext(first.length < total ? first.length : null);
  }, [first, total, who]);
  const more = async () => {
    if (!shelfId || next == null || busy.current) return;
    busy.current = true;
    setError(false);
    try {
      const target = picksTarget(shelfId);
      const r = target ? await loadPicks(resolved, who, target, next, 30) : await loadShelfPage(resolved, who, shelfId, next);
      setBooks((prev) => {
        const have = new Set(prev.map((b) => b.id));
        return [...prev, ...r.books.filter((b) => !have.has(b.id))];
      });
      setNext(r.next);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
    }
  };
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next == null || error || !active) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void more(), { rootMargin: "0px 0px 1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });
  return { books, next, error, more, sentinel };
}

export function ForYouScreen({ active: pageActive = true }: { active?: boolean }) {
  const { t, resolved } = useI18n();
  // Грузим только в открытой вкладке браузера (на ПК фоновые вкладки тоже смонтированы)
  const tabActive = useTabActive();
  const active = pageActive && tabActive;
  const navigate = useNavigate();
  const who = useRecoWho();
  const key = `${who}|${resolved}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [shelves, setShelves] = useState<Shelf[] | null>(() => cache.get(key)?.shelves ?? null);
  const [state, setState] = useState<"loading" | "ready" | "error">(shelves ? "ready" : "loading");
  const scroller = useRef<HTMLDivElement>(null);
  const hidden = useHiddenFromRecommendations();
  // Ширина карточки, поля и промежуток — как у сетки каталога, чтобы полки и лента не отличались
  const grid = useGridMetrics();
  const gridVars = { "--fy-w": `${grid.cardWidth}px`, "--fy-gap": `${grid.gap}px`, "--fy-pad": `${grid.pad}px` } as CSSProperties;

  const run = async () => {
    const k = key;
    setState("loading");
    try {
      const s = await loadForYou(resolved, who);
      cache.set(k, { at: Date.now(), shelves: s });
      // Пока считали, вкладку переключили на другой аккаунт — этот расчёт уже не её
      if (keyRef.current !== k) return;
      setShelves(s);
      setState("ready");
    } catch {
      if (keyRef.current === k) setState("error");
    }
  };
  useEffect(() => {
    if (!active) return;
    const hit = cache.get(key);
    if (hit) {
      // Другой аккаунт или язык — сразу его полки из памяти, без мигания чужими
      setShelves(hit.shelves);
      setState("ready");
    } else {
      setShelves(null);
    }
    if (!hit || Date.now() - hit.at > STALE_MS) void run();
  }, [active, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (active && shelves) lastShown = { who, shelves };
  }, [active, shelves, who]);

  const open = useStableCallback((b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`));
  const mix = shelves?.find((s) => s.kind === "mix") ?? null;
  const feed = useShelfFeed(mix?.id ?? null, who, mix?.books ?? NONE, mix?.total ?? 0, active && state === "ready");

  const refresh = () => {
    cache.delete(key);
    scroller.current?.scrollTo({ top: 0 });
    return run();
  };
  // Телефон: потянуть ленту вниз — пересчитать подборки
  const ptr = usePullToRefresh(scroller, refresh, active);

  // Сервер недоступен — рекомендации на устройстве
  if (state === "error" && !shelves) return <RecommendationsScreen active={active} />;

  return (
    <div className="screen-fill library-screen">
      {ptr}
      <div ref={scroller} className="screen-scroll ax-feed fy" style={gridVars}>
        <div ref={grid.host} className="fy-measure" />

        <Greeting count={shelves?.filter((s) => s.kind !== "continue" && s.kind !== "mix").length ?? 0} loading={state === "loading"} onRefresh={refresh} />
        {state === "loading" && !shelves && <FySkeleton />}
        {state === "error" && shelves && (
          <div className="error-block">
            <p>{t("foryou.error")}</p>
            <Button title={t("common.retry")} variant="secondary" compact onPress={refresh} />
          </div>
        )}

        {shelves
          ?.filter((s) => s.kind !== "mix")
          .map((s) => (
            <ShelfRow key={s.id} shelf={s} onOpen={open} cardWidth={grid.cardWidth} />
          ))}

        {mix && (
          <section className="fy-mix">
            <header className="fy-head">
              <div className="fy-head-text">
                <h2>{t(`foryou.shelf.${mix.title.key}`)}</h2>
              </div>
            </header>
            <BookCollection books={feed.books.filter((b) => !hidden.has(b.id))} onPress={open} enrich={false} />
            <div ref={feed.sentinel} className="fy-sentinel">
              {feed.next != null && !feed.error && <LoadingSpinner />}
              {feed.error && <Button title={t("common.retry")} variant="secondary" compact onPress={() => void feed.more()} />}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const NONE: Book[] = [];

function FySkeleton() {
  return (
    <div className="fy-skeleton" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="fy-shelf">
          <div className="fy-skel-head" />
          <div className="fy-row">
            {Array.from({ length: 7 }, (_, j) => (
              <div key={j} className="fy-item">
                <div className="fy-skel-cover" />
                <div className="fy-skel-line" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** «Ещё» у полки — вся полка лентой. */
export function ForYouShelfScreen() {
  const { shelf = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const hidden = useHiddenFromRecommendations();
  const who = useRecoWho();
  const cachedShelf = lastShown?.who === who ? (lastShown.shelves.find((s) => s.id === shelf) ?? null) : null;
  const feed = useShelfFeed(shelf, who, cachedShelf?.books ?? NONE, cachedShelf ? cachedShelf.total : 1, true);
  const open = useStableCallback((b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`));
  useEffect(() => {
    if (!feed.books.length) void feed.more();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="screen-fill library-screen">
      <div className="screen-scroll ax-feed fy">
        {feed.books.length === 0 && feed.next != null && <LoadingSpinner />}
        <BookCollection books={feed.books.filter((b) => !hidden.has(b.id))} onPress={open} enrich={false} />
        <div ref={feed.sentinel} className="fy-sentinel">
          {feed.next != null && feed.books.length > 0 && !feed.error && <LoadingSpinner />}
          {feed.error && <Button title={t("common.retry")} variant="secondary" compact onPress={() => void feed.more()} />}
        </div>
      </div>
    </div>
  );
}
