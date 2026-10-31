/**
 * Страница книги — перенос `app/book/[id]/index.tsx` + `_components/BookHeader.tsx`, `components/book/TagBlock.tsx`,
 * `PageItem.tsx`, `_components/RelatedSection.tsx` (релиз 1.3.1).
 *
 * Телефон: размытый баннер из обложки, поверх — обложка-карточка 72% ширины; ниже заголовки,
 * кнопки-пилюли (скачать · закладка · комментарии), «Читать» / «Продолжить со стр. N»,
 * Скачанная книга открывается с устройства (как useBookData в старом); кнопка скачивания —
 * «Скачать» → кольцо прогресса с отменой → корзина с подтверждением.
 * мета-строка, группы тегов, «Галерея» с переключателем колонок, сетка страниц
 * (сначала 24 ячейки и «Показать всё»), «Похожие» строкой, плавающая кнопка вверх/вниз.
 * Планшет/ПК: обложка слева, информация справа.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useMe } from "../lib/session";
import { KEYS, getItem, setItem } from "../lib/storage";
import { timeAgo } from "../lib/timeAgo";
import { Button, Icon, LoadingSpinner, NhModal, Spinner, useToast } from "../ui";

const PAGE_GAP = 10;

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

/** Колонки галереи (`galleryColumns`): по умолчанию 1 на телефоне, 3 на широком; цикл до 3 / 4. */
function useColumns(wide: boolean) {
  const [cols, setCols] = useState(() => {
    const saved = Math.min(Math.max(parseInt(getItem(KEYS.galleryColumns) ?? "0") || 0, 1), 4);
    return saved || (wide ? 3 : 1);
  });
  const cycle = () =>
    setCols((c) => {
      const n = c >= (wide ? 4 : 3) ? 1 : c + 1;
      setItem(KEYS.galleryColumns, String(n));
      return n;
    });
  return { cols, cycle };
}

export function BookScreen() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  useBrowseFilters();
  const galleryId = Number(id);
  const fromRandom = params.get("random") === "1";
  const wide = useWide();
  const { cols, cycle: cycleCols } = useColumns(wide);

  const [book, setBook] = useState<Book | null>(() => cachedFullBook(galleryId) ?? null);
  const [error, setError] = useState<unknown>(null);
  const [fav, setFav] = useState(() => isFavorite(galleryId));
  const me = useMe();
  const online = useOnlineFavorite(galleryId, !!me);
  const [comments, setComments] = useState(0);
  const [related, setRelated] = useState<Book[]>([]);
  const [relLoading, setRelLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(0);
  const [fab, setFab] = useState<{ visible: boolean; dir: "up" | "down" }>({ visible: false, dir: "down" });
  const [rndLoading, setRndLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const relatedEnriched = useEnrichedBooks(related);
  const [isLocal, setIsLocal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dl = useDownloadState();
  const downloading = dl.active && dl.bookId === galleryId;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setShowAll(false);
    setFav(isFavorite(galleryId));
    setIsLocal(false);
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

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [book !== null]);

  const progress = book ? getReadProgress(book.id) : null;
  const readBtn = (() => {
    if (!book || !progress) return { label: t("book.read"), page: 1, restart: false };
    const total = Math.max(1, progress.total || book.pagesCount || 1);
    const current = Math.min(progress.current, total - 1);
    if (current >= total - 1) return { label: t("book.readAgain"), page: 1, restart: true };
    return { label: t("book.continuePage", { page: current + 1 }), page: current + 1, restart: false };
  })();

  const innerPadding = wide ? 16 : 12;
  const horizPad = Math.max(0, innerPadding - PAGE_GAP / 2);
  const pagesShown = useMemo(() => {
    if (!book) return [];
    if (showAll) return book.pages;
    return book.pages.slice(0, Math.floor(24 / cols) * cols);
  }, [book, cols, showAll]);

  const itemW = (() => {
    const avail = Math.max(100, width - 2 * horizPad);
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
        {book.title.pretty}
      </h1>
      {book.title.english && book.title.english !== book.title.pretty && <p className="book-subtitle">{book.title.english}</p>}
      {book.title.japanese && book.title.japanese !== book.title.english && (
        <p className="book-subtitle book-subtitle-ja">{book.title.japanese}</p>
      )}
    </>
  );

  const actions = (
    <div className="book-pills">
      {downloading ? (
        <button type="button" className="book-pill is-active" aria-label={t("book.cancelDownload")} onClick={() => void cancelDownload(book.id)}>
          <span className="dl-ring">
            <Ring progress={dl.progress} size={20} />
            <Icon name="x" size={10} />
          </span>
        </button>
      ) : isLocal ? (
        <button type="button" className="book-pill is-active" aria-label={t("book.removeDownload")} onClick={() => setConfirmDelete(true)}>
          <Icon name="trash-2" size={15} />
        </button>
      ) : (
        <button type="button" className="book-pill" aria-label={t("book.download")} disabled={!book.pages.length} onClick={() => void startDownload()}>
          <Icon name="download" size={15} />
        </button>
      )}
      <button
        type="button"
        className={`book-pill${wide ? "" : " book-pill-stretch"}${fav ? " is-bookmarked" : ""}`}
        aria-label={t("menu.favorites")}
        aria-pressed={fav}
        onClick={() => setFav(toggleFavorite(book.id))}
      >
        <Icon name="bookmark" size={15} />
      </button>
      <button
        type="button"
        className="book-pill"
        aria-label={t("comments.title")}
        onClick={() => navigate(`/book/${book.id}/comments?title=${encodeURIComponent(book.title.pretty)}`)}
      >
        <Icon name="message-square" size={15} />
        {comments > 0 && <span className="book-pill-text">{fmtNum(comments)}</span>}
      </button>
      {!!me && (
        <button
          type="button"
          className={`book-pill book-pill-like${online.liked ? " is-liked" : ""}`}
          aria-label={t("menu.favoritesOnline")}
          aria-pressed={online.liked}
          disabled={online.loading}
          onClick={() => void online.toggle()}
        >
          {online.loading ? <Spinner size={14} /> : <Icon name="heart" size={14} solid={online.liked} />}
          <span className="book-pill-text">{fmtNum(book.favorites)}</span>
        </button>
      )}
    </div>
  );

  const readRow = (
    <button type="button" className="book-read" onClick={() => openReader(readBtn.page)}>
      <Icon name={readBtn.restart ? "rotate-ccw" : "book-open"} size={18} />
      <span>{readBtn.label}</span>
    </button>
  );

  const meta = (
    <div className="book-meta">
      <div className="book-meta-row">
        <Icon name="hash" size={13} />
        <span onContextMenu={() => copy(String(book.id))}>{book.id}</span>
        <span className="book-meta-dot">·</span>
        <Icon name="calendar" size={13} />
        <span>{book.uploaded ? timeAgo(book.uploaded, resolved) : "—"}</span>
        <span className="book-meta-dot">·</span>
        <Icon name="book-open" size={13} />
        <span>
          {book.pagesCount} {t("book.pages")}
        </span>
      </div>
      {book.scanlator && (
        <div className="book-meta-row">
          <Icon name="edit-3" size={13} />
          <span>Scanlated by {book.scanlator}</span>
        </div>
      )}
    </div>
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

  const galleryRow = (
    <div className="book-gallery-row">
      <span className="book-gallery-label">{t("book.gallery")}</span>
      <button type="button" className="book-layout-btn" onClick={cycleCols}>
        <Icon name="layout" size={17} />
        <span>{cols}×</span>
      </button>
    </div>
  );

  const contentW = width - innerPadding * 2;
  const cardW = contentW * 0.72;

  return (
    <div className="screen-fill book-screen">
      <div ref={scroller} className="screen-scroll" onScroll={onScroll}>
        {wide ? (
          <div className="book-wide" style={{ padding: `20px ${innerPadding}px 8px` }}>
            <button
              type="button"
              className="book-wide-cover"
              style={{ width: Math.min(280, window.innerWidth * 0.26), aspectRatio: String(coverAR) }}
              onClick={() => openReader(readBtn.page)}
            >
              <SmartImage sources={thumbSources(book.cover)} eager />
            </button>
            <div className="book-wide-info">
              {titles}
              {actions}
              {readRow}
              {meta}
              {tagBlocks}
              {galleryRow}
            </div>
          </div>
        ) : (
          <div className="book-mobile-header" style={{ padding: `0 ${innerPadding}px` }}>
            <div className="book-banner" style={{ width, marginLeft: -innerPadding, aspectRatio: String(coverAR) }}>
              <SmartImage sources={thumbSources(book.cover)} eager showLoader={false} />
              <div className="book-banner-dim" />
            </div>
            <button
              type="button"
              className="book-mobile-card"
              style={{
                left: innerPadding + (contentW - cardW) / 2,
                top: contentW * 0.08,
                width: cardW,
                height: cardW / coverAR,
              }}
              onClick={() => openReader(readBtn.page)}
            >
              <SmartImage sources={thumbSources(book.cover)} eager />
            </button>
            <div className="book-mobile-content" style={{ marginTop: cardW / coverAR + contentW * 0.08 + 14 - width / coverAR }}>
              {titles}
              {actions}
              {readRow}
              {meta}
              {tagBlocks}
              {galleryRow}
            </div>
          </div>
        )}

        <div className="book-pages" style={{ padding: `0 ${horizPad}px`, gap: cols > 1 ? 0 : undefined }}>
          {pagesShown.map((p) => (
            <PageItem key={p.page} page={p} itemW={itemW} cols={cols} onOpen={openReader} />
          ))}
        </div>

        {!showAll && pagesShown.length < book.pages.length && (
          <div className="book-show-all" style={{ padding: `20px ${horizPad}px` }}>
            <button type="button" onClick={() => setShowAll(true)}>
              {t("book.showAll")}
            </button>
          </div>
        )}

        <div className="book-related">
          <div className="book-related-label" style={{ padding: `0 ${innerPadding}px` }}>
            {t("related")}
          </div>
          {relLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="book-related-row" style={{ padding: `0 ${innerPadding * 1.9}px` }}>
              {relatedEnriched.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  cardWidth={Math.max(180, Math.min(220, (width - innerPadding * 3.8) / 2))}
                  onPress={(x) => navigate(`/book/${x.id}?title=${encodeURIComponent(x.title.pretty)}`)}
                />
              ))}
            </div>
          )}
        </div>
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

/** Группа тегов — TagBlock: «Метка:», капсулы с числом и кнопкой цикла фильтра. */
function TagBlock({ label, tags, onTagPress }: { label: string; tags: Tag[]; onTagPress: (tag: Tag) => void }) {
  if (!tags.length) return null;
  return (
    <div className="tag-block">
      <div className="tag-block-label">{label}:</div>
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
              <span className="tag-pill-name">{tag.name}</span>
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
