/**
 * Страница книги — перенос `app/book/[id]/index.tsx` + `_components/BookHeader.tsx`, `components/book/TagBlock.tsx`,
 * `PageItem.tsx`, `_components/RelatedSection.tsx` (релиз 1.3.1).
 *
 * Страница ограничена по ширине (как лента каталога), за шапкой — размытая обложка:
 *  - шапка: обложка и рядом (на телефоне — под ней) названия, переводчик и группы тегов;
 *  - «Галерея»: строка из первых 15 страниц с прокруткой вбок и «+N» в конце; «Показать всё» — полная сетка
 *    с выбором колонок;
 *  - «Похожие» — строкой.
 * Цифры (страниц · когда загружена · номер) — в верхней панели (`PageBar`); действия (скачать · закладка ·
 * обсуждение · нравится с числом избранного) и «Читать» / «Продолжить» — плавающей панелью снизу.
 * Скачанная книга открывается с устройства (как useBookData в старом); плитка скачивания —
 * «Скачать» → кольцо прогресса с отменой → корзина с подтверждением.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { galleryRelatedToBook, galleryToBook, type Book, type BookPage } from "../api/book";
import { getCommentCount, getGallery, getRandomGalleryId, getRelatedGalleries } from "../api/galleries";
import { initCdn, pageSources, thumbSources } from "../api/media";
import type { Tag } from "../api/types";
import { BookCard } from "../components/BookCard";
import { SmartImage } from "../components/SmartImage";
import { errorText, useI18n } from "../i18n/I18nContext";
import { cachedFullBook, rememberFullBook, useEnrichedBooks } from "../lib/bookEnrich";
import { rememberGallery } from "../lib/bookCards";
import { cycleTag, tagMode, useBrowseFilters } from "../lib/browseFilters";
import { cancelDownload, deleteDownload, downloadBook, loadLocalBook, useDownloadState } from "../lib/downloads";
import { getReadProgress, isFavorite, toggleFavorite } from "../lib/library";
import { useOnlineFavorite } from "../lib/onlineFavorites";
import { useTagLabel } from "../lib/tagTranslations";
import { useBookTitle } from "../lib/titleTranslations";
import { useMe } from "../lib/session";
import { KEYS, getItem, setItem } from "../lib/storage";
import { timeAgo } from "../lib/timeAgo";
import { Button, Icon, LoadingSpinner, NhModal, Spinner, useToast } from "../ui";
import { openLogin } from "../shell/LoginModal";
import { PageBar } from "../shell/PageBar";
import { cachedCharacterCatalog, getCharacterCatalog, type CharacterCatalogItem } from "../api/community";
import { CroppedImage } from "./CharactersScreen";
import { useRecoWho } from "./ForYouScreen";
import { loadPicks, useHiddenFromRecommendations } from "../lib/forYou";

const PAGE_GAP = 10;
/** Сколько страниц в строке предпросмотра галереи. */
const STRIP_COUNT = 15;

function fmtNum(n: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Как useWindowLayout: «широкий» — планшет или альбомная ориентация от 400px. */
function useWide() {
  const calc = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return Math.min(w, h) >= 600 || (w > h && w >= 400);
  };
  const [wide, setWide] = useState(calc);
  useEffect(() => {
    const on = () => setWide(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

/** Колонки галереи (`galleryColumns`): по умолчанию 1 на телефоне, 3 на широком; до 3 / 4. */
function useColumns(wide: boolean) {
  const [cols, setCols] = useState(() => {
    const saved = Math.min(Math.max(parseInt(getItem(KEYS.galleryColumns) ?? "0") || 0, 1), 4);
    return saved || (wide ? 3 : 1);
  });
  const max = wide ? 4 : 3;
  const choose = (n: number) => {
    setItem(KEYS.galleryColumns, String(n));
    setCols(n);
  };
  return { cols: Math.min(cols, max), max, choose };
}

const NO_TITLE = { english: "", japanese: "", pretty: "" };

/** Откуда «Похожие» на странице книги: MoeLibre (по умолчанию) или nhentai. */
const RELATED_SRC_KEY = "ui.book.relatedSource";

export function BookScreen() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  // Фильтры каталога: выбранные теги учитываются и в «Похожих» от MoeLibre
  const browseFilters = useBrowseFilters();
  const galleryId = Number(id);
  const fromRandom = params.get("random") === "1";
  const wide = useWide();
  const { cols, max: maxCols, choose: chooseCols } = useColumns(wide);

  const [book, setBook] = useState<Book | null>(() => cachedFullBook(galleryId) ?? null);
  // Заголовок: перевод / английское / оригинал — по настройке «Названия книг на языке интерфейса»
  const heading = useBookTitle(book ?? { id: galleryId, title: NO_TITLE });
  const [error, setError] = useState<unknown>(null);
  const [fav, setFav] = useState(() => isFavorite(galleryId));
  const me = useMe();
  const online = useOnlineFavorite(galleryId, !!me);
  // Число избранного пришло с книгой — поставили / сняли «нравится» здесь, число сразу ±1
  const likedAtLoad = useRef<boolean | null>(null);
  if (likedAtLoad.current === null && me && !online.loading) likedAtLoad.current = online.liked;
  const [comments, setComments] = useState(0);
  const [related, setRelated] = useState<Book[]>([]);
  const [relLoading, setRelLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(0);
  const [fab, setFab] = useState<{ visible: boolean; dir: "up" | "down" }>({ visible: false, dir: "down" });
  const [rndLoading, setRndLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const relatedEnriched = useEnrichedBooks(related);
  // «Похожие»: от MoeLibre (сервер рекомендаций — та же франшиза и персонажи, с учётом вашего вкуса) или от nhentai
  const [relSrc, setRelSrc] = useState<"moelibre" | "nhentai">(() => (getItem(RELATED_SRC_KEY) === "nhentai" ? "nhentai" : "moelibre"));
  const chooseRelSrc = (v: "moelibre" | "nhentai") => {
    setRelSrc(v);
    setItem(RELATED_SRC_KEY, v);
  };
  const recoWho = useRecoWho();
  const hiddenReco = useHiddenFromRecommendations();
  const [picks, setPicks] = useState<{ books: Book[]; more: boolean } | "error" | null>(null);
  useEffect(() => {
    if (relSrc !== "moelibre" || !galleryId) return;
    let cancelled = false;
    setPicks(null);
    loadPicks(resolved, recoWho, { kind: "book", book: galleryId }, 0, 24)
      .then((r) => !cancelled && setPicks({ books: r.books, more: r.next != null }))
      .catch(() => !cancelled && setPicks("error"));
    return () => {
      cancelled = true;
    };
  }, [relSrc, galleryId, recoWho, resolved, browseFilters]);
  const [isLocal, setIsLocal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dl = useDownloadState();
  const downloading = dl.active && dl.bookId === galleryId;
  const tagLabel = useTagLabel();
  // Персонажи книги, у которых есть карточка в базе MoeLibre (каталог сообщества) — под обложкой
  const [catalog, setCatalog] = useState<CharacterCatalogItem[] | null>(() => cachedCharacterCatalog());
  useEffect(() => {
    if (catalog) return;
    let alive = true;
    getCharacterCatalog()
      .then((list) => alive && setCatalog(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const characters = useMemo(() => {
    if (!book?.characters.length || !catalog) return [];
    const norm = (x: string) => x.normalize("NFKC").toLowerCase().trim();
    const byName = new Map<string, CharacterCatalogItem[]>();
    for (const item of catalog) {
      if (!item.imageUrl || !item.rect) continue;
      const key = norm(item.characterName);
      byName.set(key, [...(byName.get(key) ?? []), item]);
    }
    // Тёзки из разных пародий — берём карточку пародии этой книги
    const parodies = new Set(book.parodies.map((p) => norm(p.name)));
    return book.characters.flatMap((tag) => {
      const items = byName.get(norm(tag.name));
      if (!items) return [];
      const item = items.find((i) => i.parodyName && parodies.has(norm(i.parodyName))) ?? items[0];
      return [{ tag, item }];
    });
  }, [book, catalog]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setShowAll(false);
    setFav(isFavorite(galleryId));
    setIsLocal(false);
    likedAtLoad.current = null;
    const cached = cachedFullBook(galleryId);
    setBook(cached ?? null);
    scroller.current?.scrollTo({ top: 0 });
    (async () => {
      try {
        // Скачанная — с устройства: открывается без сети, страницы — локальные файлы
        const local = await loadLocalBook(galleryId);
        if (cancelled) return;
        if (local) {
          setIsLocal(true);
          setBook(local);
          return;
        }
        await initCdn();
        const g = cached ? null : await getGallery(galleryId);
        if (cancelled) return;
        const b = g ? galleryToBook(g) : cached!;
        if (g) {
          rememberFullBook(b);
          rememberGallery(g);
        }
        setBook(b);
        // Заголовок в шапке берётся из ?title= — как router.setParams в старом
        if (!params.get("title") && b.title.pretty) {
          const p = new URLSearchParams(params);
          p.set("title", b.title.pretty);
          navigate(`/book/${galleryId}?${p.toString()}`, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    setRelLoading(true);
    getRelatedGalleries(galleryId)
      .then((list) => !cancelled && setRelated(list.map(galleryRelatedToBook)))
      .catch(() => !cancelled && setRelated([]))
      .finally(() => !cancelled && setRelLoading(false));
    getCommentCount(galleryId)
      .then((n) => !cancelled && setComments(n))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // params читаем только для подстановки заголовка
  }, [galleryId]);

  // Загрузка закончилась (в т.ч. с другого экрана) или книгу удалили — переключаемся на нужную копию
  useEffect(() => {
    if (!dl.lastFinishedAt || dl.lastFinishedBookId !== galleryId) return;
    let cancelled = false;
    void loadLocalBook(galleryId).then(async (local) => {
      if (cancelled) return;
      if (local) {
        setIsLocal(true);
        setBook(local);
        return;
      }
      setIsLocal(false);
      try {
        await initCdn();
        const g = await getGallery(galleryId);
        if (!cancelled) setBook(galleryToBook(g));
      } catch {
        /* без сети остаёмся на текущем */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dl.lastFinishedAt, dl.lastFinishedBookId, galleryId]);

  const startDownload = async () => {
    if (!book) return;
    const r = await downloadBook(book);
    if (r === "busy") showToast({ title: t("downloads.busy") });
  };

  const removeDownload = async () => {
    setConfirmDelete(false);
    const ok = await deleteDownload(galleryId).catch(() => false);
    showToast({ title: ok ? t("downloads.deleted") : t("downloads.notFound"), type: ok ? "success" : "error" });
  };

  // Ширина содержимого страницы (без полей) — для сетки страниц и карточек «Похожих»
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [book !== null]);

  const progress = book ? getReadProgress(book.id) : null;
  const readBtn = (() => {
    if (!book || !progress) return { label: t("book.read"), page: 1, restart: false, sub: "", pct: 0 };
    const total = Math.max(1, progress.total || book.pagesCount || 1);
    const current = Math.min(progress.current, total - 1);
    if (current >= total - 1) return { label: t("book.readAgain"), page: 1, restart: true, sub: "", pct: 0 };
    // Продолжить: подпись короткая, страница — числом «12 / 39», прочитанное — полоской по низу кнопки
    return { label: t("bookx.continue"), page: current + 1, restart: false, sub: `${current + 1} / ${total}`, pct: ((current + 1) / total) * 100 };
  })();

  const itemW = (() => {
    const avail = Math.max(100, width);
    if (cols === 1) return avail;
    return Math.max(100, Math.min(Math.floor((avail - (cols - 1) * PAGE_GAP) / cols), avail));
  })();

  const openReader = (page: number) => navigate(`/read/${galleryId}?page=${page}`);
  const onTagPress = (tag: Tag) => {
    const solo = getItem(KEYS.resetTagsOnBookTagNav) === "true";
    navigate(`/explore?query=${encodeURIComponent(tag.name)}${solo ? "&solo=1" : ""}`);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const y = el.scrollTop;
    const dy = y - lastY.current;
    lastY.current = y;
    setFab((f) => {
      let dir = f.dir;
      if (Math.abs(dy) > 5) {
        if (y < 200) dir = "down";
        else if (y + el.clientHeight > el.scrollHeight - 200) dir = "up";
        else dir = dy > 0 ? "down" : "up";
      }
      const visible = y > 160 ? true : y < 100 ? false : f.visible;
      return visible === f.visible && dir === f.dir ? f : { visible, dir };
    });
  };

  const goRandomAgain = async () => {
    if (rndLoading) return;
    setRndLoading(true);
    try {
      const rid = await getRandomGalleryId();
      navigate(`/book/${rid}?random=1`, { replace: true });
    } catch {
      /* молча, как в старом */
    } finally {
      setRndLoading(false);
    }
  };

  if (error && !book) {
    return (
      <div className="error-block">
        <p>{errorText(t, error, "errors.book")}</p>
        <Button title={t("common.back")} variant="secondary" compact onPress={() => navigate(-1)} />
      </div>
    );
  }

  if (!book) return <LoadingSpinner fullScreen />;

  const coverAR = book.coverW && book.coverH ? book.coverW / book.coverH : 3 / 4;
  const skip = new Set(
    [...book.artists, ...book.characters, ...book.parodies, ...book.groups, ...book.categories, ...book.languages].map(
      (x) => x.name,
    ),
  );
  const plainTags = book.tags.filter((x) => !skip.has(x.name));
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  const titles = (
    <>
      <h1 className={wide ? "book-title book-title-wide" : "book-title"} onContextMenu={() => copy(book.title.pretty)}>
        {heading}
      </h1>
      {/* Заголовок — перевод на язык интерфейса или английское название; ниже полные оригиналы */}
      {book.title.english && book.title.english !== heading && <p className="book-subtitle">{book.title.english}</p>}
      {book.title.japanese && book.title.japanese !== book.title.english && (
        <p className="book-subtitle book-subtitle-ja">{book.title.japanese}</p>
      )}
    </>
  );

  // Действия — плитки: значок и подпись (ряд под «Читать»)
  const actions = (
    <div className="book-acts">
      {downloading ? (
        <button type="button" className="book-act is-on" onClick={() => void cancelDownload(book.id)}>
          <span className="dl-ring">
            <Ring progress={dl.progress} size={22} />
            <Icon name="x" size={10} />
          </span>
          <span>{Math.round((dl.progress || 0) * 100)}%</span>
        </button>
      ) : isLocal ? (
        <button type="button" className="book-act is-on" aria-label={t("book.removeDownload")} title={t("bookx.downloaded")} onClick={() => setConfirmDelete(true)}>
          <Icon name="check-circle" size={20} />
          <span className="book-act-label">{t("bookx.downloaded")}</span>
        </button>
      ) : (
        <button type="button" className="book-act" title={t("bookx.download")} aria-label={t("bookx.download")} disabled={!book.pages.length} onClick={() => void startDownload()}>
          <Icon name="download" size={20} />
          <span className="book-act-label">{t("bookx.download")}</span>
        </button>
      )}
      <button type="button" className={fav ? "book-act is-bookmarked" : "book-act"} aria-pressed={fav} title={fav ? t("book.inFavorites") : t("book.addFavorite")} aria-label={fav ? t("book.inFavorites") : t("book.addFavorite")} onClick={() => setFav(toggleFavorite(book.id))}>
        <Icon name="bookmark" size={20} solid={fav} />
        <span className="book-act-label">{fav ? t("book.inFavorites") : t("book.addFavorite")}</span>
      </button>
      <button type="button" className="book-act" title={t("bookx.comments")} aria-label={t("bookx.comments")} onClick={() => navigate(`/book/${book.id}/comments?title=${encodeURIComponent(book.title.pretty)}`)}>
        <Icon name="message-square" size={20} />
        <span className={comments > 0 ? undefined : "book-act-label"}>{comments > 0 ? fmtNum(comments) : t("bookx.comments")}</span>
      </button>
      {/* «Нравится» и число избранного nhentai — одно и то же: число прямо на кнопке. Без входа — окно входа */}
      <button
        type="button"
        className={me && online.liked ? "book-act is-liked" : "book-act"}
        aria-label={t("bookx.like")}
        title={t("bookx.like")}
        aria-pressed={!!me && online.liked}
        disabled={!!me && online.loading}
        onClick={() => (me ? void online.toggle() : openLogin())}
      >
        {me && online.loading ? <Spinner size={20} /> : <Icon name="heart" size={20} solid={!!me && online.liked} />}
        <span>{fmtNum(book.favorites + (likedAtLoad.current !== null && online.liked !== likedAtLoad.current ? (online.liked ? 1 : -1) : 0))}</span>
      </button>
    </div>
  );

  const readRow = (
    <button type="button" className={readBtn.sub ? "book-read has-sub" : "book-read"} onClick={() => openReader(readBtn.page)}>
      <Icon name={readBtn.restart ? "rotate-ccw" : "book-open"} size={18} />
      <span className="book-read-label">{readBtn.label}</span>
      {readBtn.sub && <span className="book-read-sub">{readBtn.sub}</span>}
      {readBtn.pct > 0 && <i className="book-read-progress" style={{ width: `${readBtn.pct}%` }} />}
    </button>
  );

  // Цифры книги — коротко в строке заголовка (вверху), номер копируется нажатием
  const headInfo = (
    <div className="book-headinfo">
      <span title={t("bookx.statPages")}>
        <Icon name="file-text" size={14} />
        {book.pagesCount}
      </span>
      <span title={t("bookx.statUploaded")}>
        <Icon name="clock" size={14} />
        {book.uploaded ? timeAgo(book.uploaded, resolved) : "—"}
      </span>
      <button type="button" className="book-headinfo-id" title={t("bookx.statId")} onClick={() => copy(String(book.id))}>
        <Icon name="hash" size={14} />
        {book.id}
      </button>
    </div>
  );
  const meta = (
    <>
      {book.scanlator && (
        <div className="book-meta-row book-scanlator">
          <Icon name="edit-3" size={13} />
          <span>Scanlated by {book.scanlator}</span>
        </div>
      )}
    </>
  );

  const tagBlocks = (
    <>
      <TagBlock label={t("tags.artists")} tags={book.artists} onTagPress={onTagPress} />
      <TagBlock label={t("tags.characters")} tags={book.characters} onTagPress={onTagPress} />
      <TagBlock label={t("tags.parodies")} tags={book.parodies} onTagPress={onTagPress} />
      <TagBlock label={t("tags.groups")} tags={book.groups} onTagPress={onTagPress} />
      <TagBlock label={t("tags.categories")} tags={book.categories} onTagPress={onTagPress} />
      <TagBlock label={t("tags.languages")} tags={book.languages} onTagPress={onTagPress} />
      <TagBlock label={t("tags.tags")} tags={plainTags} onTagPress={onTagPress} />
    </>
  );

  // Выбор колонок — только для полной сетки страниц
  const colsPicker = (
    <div className="book-cols" role="radiogroup" aria-label={t("bookx.columns")}>
      {Array.from({ length: maxCols }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={cols === n} className={cols === n ? "is-on" : undefined} onClick={() => chooseCols(n)}>
          {n}
        </button>
      ))}
    </div>
  );

  const pagesTotal = book.pages.length || book.pagesCount;
  const strip = book.pages.slice(0, STRIP_COUNT);
  // «Похожие»: на широком экране — целое число карточек во всю ширину (листаются стрелками), на телефоне — с краем
  // следующей, чтобы было видно, что строка листается
  const relatedW = wide ? (() => {
    const n = Math.max(2, Math.floor((width + 12) / (196 + 12)));
    return Math.floor((width - 12 * (n - 1)) / n);
  })() : Math.max(150, Math.min(200, (width - 12) / 2.2));

  return (
    <div className="screen-fill book-screen">
      {/* Цифры книги — в верхней панели (строка заголовка), а не в ленте */}
      <PageBar>{headInfo}</PageBar>
      <div ref={scroller} className="screen-scroll" onScroll={onScroll}>
        {/* Размытая обложка за шапкой страницы — уходит в фон */}
        <div className="bk-backdrop" aria-hidden>
          <SmartImage sources={thumbSources(book.cover)} eager showLoader={false} />
        </div>
        <div ref={pageRef} className="bk-page">
          <section className="bk-hero">
            <div className="bk-side">
              <button type="button" className="bk-cover" style={{ aspectRatio: String(coverAR) }} onClick={() => openReader(readBtn.page)}>
                <SmartImage sources={thumbSources(book.cover)} eager />
              </button>
              {/* Персонажи с карточкой в базе — под обложкой (на телефоне — после тегов); нажатие — поиск по персонажу */}
              {characters.length > 0 && (
                <div className="bk-chars">
                  <div className="bk-chars-label">{t("tags.characters")}</div>
                  <div className="bk-chars-grid">
                    {characters.map(({ tag, item }) => (
                      <button key={tag.name} type="button" className="bk-char" title={item.parodyName ?? undefined} onClick={() => onTagPress(tag)}>
                        <span className="bk-char-img">
                          <CroppedImage url={item.imageUrl} rect={item.rect} />
                        </span>
                        <span className="bk-char-name">{tagLabel(tag.type, tag.name)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="bk-info">
              {titles}
              {meta}
              {tagBlocks}
            </div>
          </section>

          {/* Галерея: строка из первых 15 страниц, «Все страницы» — полная сетка с выбором колонок */}
          {pagesTotal > 0 && (
            <section className="bk-section">
              <div className="bk-sec-head">
                <h2>
                  {t("book.gallery")}
                  <span>{pagesTotal}</span>
                </h2>
                {showAll && colsPicker}
                {book.pages.length > STRIP_COUNT && (
                  <button type="button" className="bk-sec-btn" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t("common.hide") : t("book.showAll")}
                    <Icon name={showAll ? "chevron-up" : "chevron-right"} size={16} />
                  </button>
                )}
              </div>
              {showAll ? (
                <div className="book-pages" style={{ gap: cols > 1 ? 0 : undefined, margin: cols > 1 ? `0 -${PAGE_GAP / 2}px` : undefined }}>
                  {book.pages.map((p) => (
                    <PageItem key={p.page} page={p} itemW={itemW} cols={cols} onOpen={openReader} />
                  ))}
                </div>
              ) : (
                <Shelf className="bk-strip">
                  {strip.map((p) => (
                    <button
                      key={p.page}
                      type="button"
                      className="bk-thumb"
                      style={{ aspectRatio: `${p.width || 1} / ${Math.min(p.height || 1.4, (p.width || 1) * 2)}` }}
                      onClick={() => openReader(p.page)}
                    >
                      <SmartImage sources={p.thumb ? thumbSources(p.thumb) : pageSources(p.path)} />
                      <span className="bk-thumb-num">{p.page}</span>
                    </button>
                  ))}
                  {book.pages.length > STRIP_COUNT && (
                    <button type="button" className="bk-thumb bk-thumb-more" onClick={() => setShowAll(true)}>
                      <b>+{book.pages.length - STRIP_COUNT}</b>
                      <span>{t("book.showAll")}</span>
                    </button>
                  )}
                </Shelf>
              )}
            </section>
          )}

          {/* «Похожие»: от MoeLibre (по умолчанию) или от nhentai. MoeLibre не ответил / пусто — список nhentai */}
          {(() => {
            const fromMl = relSrc === "moelibre" && picks !== "error" && !(picks && picks.books.length === 0);
            const list = fromMl ? (picks ? picks.books.filter((b) => !hiddenReco.has(b.id)) : null) : relLoading ? null : relatedEnriched;
            const openBook = (x: Book) => navigate(`/book/${x.id}?title=${encodeURIComponent(x.title.pretty)}`);
            return (
              <section className="bk-section">
                <div className="bk-sec-head">
                  <h2>{t("related")}</h2>
                  <div className="bk-src" role="radiogroup" aria-label={t("related")}>
                    {(["moelibre", "nhentai"] as const).map((v) => (
                      <button key={v} type="button" role="radio" aria-checked={relSrc === v} className={relSrc === v ? "is-on" : undefined} onClick={() => chooseRelSrc(v)}>
                        {v === "moelibre" ? "MoeLibre" : "nhentai"}
                      </button>
                    ))}
                  </div>
                  {fromMl && picks && picks.more && (
                    <button
                      type="button"
                      className="bk-sec-btn"
                      onClick={() => navigate(`/foryou/${encodeURIComponent(`book:${galleryId}`)}?title=${encodeURIComponent(`${t("related")} · MoeLibre`)}`)}
                    >
                      {t("foryou.more")}
                      <Icon name="chevron-right" size={16} />
                    </button>
                  )}
                </div>
                {list == null ? (
                  <LoadingSpinner />
                ) : (
                  <Shelf className="bk-related">
                    {list.map((b) => (
                      <BookCard key={b.id} book={b} cardWidth={relatedW} onPress={openBook} />
                    ))}
                  </Shelf>
                )}
              </section>
            );
          })()}
        </div>
      </div>

      {/* Действия и «Читать» — плавающая панель снизу (выезжает при открытии книги) */}
      <div className="book-dock">
        {actions}
        {readRow}
      </div>

      <button
        type="button"
        className={fab.visible ? "book-fab is-visible" : "book-fab"}
        aria-label={fab.dir === "down" ? "↓" : "↑"}
        onClick={() => {
          const el = scroller.current;
          if (!el) return;
          el.scrollTo({ top: fab.dir === "down" ? el.scrollHeight : 0, behavior: "smooth" });
        }}
      >
        <Icon name={fab.dir === "down" ? "arrow-down" : "arrow-up"} size={24} />
      </button>

      {fromRandom && (
        <div className="book-try">
          <button type="button" disabled={rndLoading} onClick={goRandomAgain}>
            {rndLoading ? (
              <Spinner size={18} />
            ) : (
              <>
                <Icon name="shuffle" size={16} />
                <span>{t("book.fromRandomCta")}</span>
              </>
            )}
          </button>
        </div>
      )}
      <NhModal visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("book.removeDownload")}>
        <div className="fo-confirm">
          <p>{t("book.removeDownloadConfirm")}</p>
          <div>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="is-accent" onClick={() => void removeDownload()}>
              {t("common.delete")}
            </button>
          </div>
        </div>
      </NhModal>
    </div>
  );
}

/**
 * Витрина — строка с прокруткой вбок. На ПК без полосы прокрутки: по бокам стрелки (при наведении), листают
 * на ширину строки; края строки, за которыми есть ещё, плавно затухают. На телефоне — листается пальцем.
 */
function Shelf({ className, children }: { className: string; children: ReactNode }) {
  const { t } = useI18n();
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [update]);
  useEffect(update, [children, update]);
  const page = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * Math.max(200, row.current.clientWidth * 0.86), behavior: "smooth" });
  return (
    <div className={`bk-shelf${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
      <div ref={row} className={className} onScroll={update}>
        {children}
      </div>
      <button type="button" className="bk-shelf-arrow is-prev" aria-label={t("common.back")} onClick={() => page(-1)}>
        <Icon name="chevron-left" size={22} />
      </button>
      <button type="button" className="bk-shelf-arrow is-next" aria-label={t("common.nextPage")} onClick={() => page(1)}>
        <Icon name="chevron-right" size={22} />
      </button>
    </div>
  );
}

/** Группа тегов — TagBlock: «Метка:», капсулы с числом и кнопкой цикла фильтра. */
function TagBlock({ label, tags, onTagPress }: { label: string; tags: Tag[]; onTagPress: (tag: Tag) => void }) {
  const tagLabel = useTagLabel();
  if (!tags.length) return null;
  return (
    <div className="tag-block">
      <div className="tag-block-label">{label}</div>
      <div className="tag-block-wrap">
        {tags.map((tag) => {
          const mode = tagMode(tag.type, tag.name);
          return (
            <div
              key={`${tag.type}:${tag.name}`}
              role="button"
              tabIndex={0}
              className={`tag-pill${mode ? ` is-${mode}` : ""}`}
              onClick={() => onTagPress(tag)}
              onContextMenu={(e) => {
                e.preventDefault();
                void navigator.clipboard?.writeText(tag.name).catch(() => undefined);
              }}
            >
              <span className="tag-pill-name">{tagLabel(tag.type, tag.name)}</span>
              {!!tag.count && <span className="tag-pill-count">{tag.count}</span>}
              <button
                type="button"
                className="tag-pill-cycle"
                aria-label={mode ?? "include"}
                onClick={(e) => {
                  e.stopPropagation();
                  cycleTag(tag.type, tag.name);
                }}
              >
                <Icon name={mode === "include" ? "check-circle" : mode === "exclude" ? "minus-circle" : "plus-circle"} size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ячейка страницы — PageItem: высота по пропорциям (очень длинные — не выше 2,5 ширины), номер под ней. */
function PageItem({ page, itemW, cols, onOpen }: { page: BookPage; itemW: number; cols: number; onOpen: (n: number) => void }) {
  const w = page.width || 1;
  const h = page.height || 1.4;
  const superLong = h > w && h > w * 3;
  const imageH = superLong ? Math.min(itemW / (w / h), itemW * 2.5) : itemW / (w / h);
  return (
    <div className="page-item" style={{ width: itemW, margin: cols > 1 ? `0 ${PAGE_GAP / 2}px ${PAGE_GAP}px` : `0 0 ${PAGE_GAP}px` }}>
      <button type="button" className="page-item-img" style={{ height: imageH }} onClick={() => onOpen(page.page)}>
        <SmartImage sources={pageSources(page.path)} fit="contain" />
      </button>
      <div className="page-item-num">{page.page}</div>
    </div>
  );
}

/** Кольцо прогресса — `components/book/Ring.tsx`. */
export function Ring({ progress, size = 22, stroke = 3 }: { progress: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="ring-fill"
      />
    </svg>
  );
}
