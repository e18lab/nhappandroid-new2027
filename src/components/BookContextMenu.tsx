/**
 * Меню тайтла: правая кнопка мыши на ПК, долгое нажатие на телефоне (WebView Android присылает тот же
 * `contextmenu`). На ПК — у курсора, как меню вкладки; на телефоне — лист снизу с названием книги.
 *
 * Что внутри: открыть / в новой вкладке, читать (с места остановки), закладка, «нравится» на nhentai
 * (если вошли; состояние — из локального списка, без запроса к nhentai), скачать, копировать ссылку,
 * название, номер, поделиться (если система умеет).
 *
 * Подключение к карточке: `const menu = useBookContextMenu(book, onOpen)` → `onContextMenu={menu.open}`
 * на корне карточки и `{menu.element}` рядом.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { galleryToBook, type Book } from "../api/book";
import { addFavorite, getGallery, removeFavorite } from "../api/galleries";
import { getActiveTabId, getTabs, openTab } from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { cachedFullBook, rememberFullBook } from "../lib/bookEnrich";
import { cancelDownload, deleteDownload, downloadBook, loadLocalBook, useDownloadState } from "../lib/downloads";
import { getReadProgress, toggleFavorite, useIsFavorite } from "../lib/library";
import { addOnlineFavoriteIds, readOnlineFavoriteIds, removeOnlineFavoriteIds } from "../lib/onlineFavorites";
import { hideFromRecommendations } from "../lib/forYou";
import { IS_DESKTOP } from "../lib/platform";
import { useMe } from "../lib/session";
import { useBookTitle } from "../lib/titleTranslations";
import { Icon, useToast, type IconName } from "../ui";

interface Item {
  key: string;
  label: string;
  icon: IconName;
  solid?: boolean;
  disabled?: boolean;
  /** Опасное действие: первое нажатие меняет подпись на эту (меню не закрывается), второе — выполняет. */
  confirm?: string;
  danger?: boolean;
  run: () => void | Promise<void>;
}

const bookPath = (b: Book) => `/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`;
const bookUrl = (b: Book) => `https://nhentai.net/g/${b.id}/`;

/** Книга со страницами (для скачивания): из кэша полных книг или с nhentai. */
async function fullBook(b: Book): Promise<Book> {
  if (b.pages.length) return b;
  const cached = cachedFullBook(b.id);
  if (cached?.pages.length) return cached;
  const full = galleryToBook(await getGallery(b.id));
  rememberFullBook(full);
  return full;
}

export function useBookContextMenu(book: Book, onOpen?: (b: Book) => void) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const open = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!IS_DESKTOP) navigator.vibrate?.(12);
    setAt({ x: e.clientX, y: e.clientY });
  }, []);
  const close = useCallback(() => setAt(null), []);
  const element: ReactNode = at ? <BookContextMenu book={book} at={at} onOpen={onOpen} onClose={close} /> : null;
  return { open, element };
}

function BookContextMenu({ book, at, onOpen, onClose }: { book: Book; at: { x: number; y: number }; onOpen?: (b: Book) => void; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const title = useBookTitle(book);
  const fav = useIsFavorite(book.id);
  const me = useMe();
  const liked = !!me && readOnlineFavoriteIds().includes(book.id);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const sheet = !IS_DESKTOP;
  const dl = useDownloadState();
  const downloading = dl.active && dl.bookId === book.id;
  // Скачана ли книга (на устройстве): проверка при открытии меню; пока не знаем — пункт «Скачать»
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadLocalBook(book.id).then((b) => alive && setSaved(!!b));
    return () => {
      alive = false;
    };
  }, [book.id, dl.lastFinishedAt]);

  // ПК: у курсора, не вылезая за край окна
  useLayoutEffect(() => {
    const el = panel.current;
    if (sheet || !el) return;
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [at.x, at.y, sheet]);

  // Закрыть: Esc, смена размера окна. Нажатие мимо ловит подложка (`bm-host`) — оно не должно
  // дойти до карточки под ней и открыть её.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Меню рендерится внутри карточки (портал), и события React всплывают в неё — останавливаем на подложке
  const dismiss = {
    onClick: (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (e.target === e.currentTarget) onClose();
    },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === e.currentTarget) onClose();
    },
    onWheel: () => !sheet && onClose(),
  };

  const copy = (text: string, done: string) =>
    navigator.clipboard?.writeText(text).then(
      () => showToast({ title: done, type: "success" }),
      () => undefined,
    );

  const progress = getReadProgress(book.id);
  const total = Math.max(1, progress?.total || book.pagesCount || 1);
  const resume = progress && progress.current > 0 && progress.current < total - 1 ? progress.current + 1 : 0;

  const groups: Item[][] = [
    [
      { key: "open", label: t("bookmenu.open"), icon: "arrow-up-right", run: () => (onOpen ? onOpen(book) : navigate(bookPath(book))) },
      {
        key: "tab",
        label: t("bookmenu.newTab"),
        icon: "plus",
        run: () => {
          const tab = getTabs().find((x) => x.id === getActiveTabId());
          openTab(tab?.resource, bookPath(book), tab?.id, tab?.account);
        },
      },
      {
        key: "read",
        label: resume ? `${t("bookx.continue")} · ${resume} / ${total}` : t("book.read"),
        icon: "book-open",
        run: () => navigate(`/read/${book.id}?page=${resume || 1}`),
      },
    ],
    [
      { key: "fav", label: fav ? t("bookmenu.unbookmark") : t("book.addFavorite"), icon: "bookmark", solid: fav, run: () => void toggleFavorite(book.id) },
      ...(me
        ? [
            {
              key: "like",
              label: liked ? t("bookmenu.unlike") : t("bookmenu.like"),
              icon: "heart" as const,
              solid: liked,
              run: async () => {
                try {
                  if (liked) {
                    await removeFavorite(book.id);
                    removeOnlineFavoriteIds([book.id]);
                  } else {
                    await addFavorite(book.id);
                    addOnlineFavoriteIds([book.id]);
                  }
                  showToast({ title: liked ? t("bookmenu.unliked") : t("bookmenu.liked"), type: "success" });
                } catch {
                  showToast({ title: t("bookmenu.failed"), type: "error" });
                }
              },
            },
          ]
        : []),
      downloading
        ? { key: "cancel", label: t("bookmenu.cancelDownload"), icon: "x-circle", run: () => cancelDownload(book.id) }
        : saved
          ? {
              key: "delete",
              label: t("bookmenu.deleteDownload"),
              icon: "x-circle",
              danger: true,
              confirm: t("bookmenu.deleteConfirm"),
              run: async () => {
                const ok = await deleteDownload(book.id).catch(() => false);
                showToast({ title: ok ? t("downloads.deleted") : t("downloads.notFound"), type: ok ? "success" : "error" });
              },
            }
          : {
              key: "dl",
              label: t("bookx.download"),
              icon: "download",
              run: async () => {
                try {
                  const r = await downloadBook(await fullBook(book));
                  if (r === "busy") showToast({ title: t("downloads.busy") });
                } catch {
                  showToast({ title: t("bookmenu.failed"), type: "error" });
                }
              },
            },
    ],
    [
      {
        key: "hide",
        label: t("bookmenu.hide"),
        icon: "eye-off",
        run: () => {
          hideFromRecommendations(book.id);
          showToast({ title: t("bookmenu.hidden") });
        },
      },
      { key: "link", label: t("bookmenu.copyLink"), icon: "copy", run: () => void copy(bookUrl(book), t("bookmenu.copied")) },
      { key: "title", label: t("bookmenu.copyTitle"), icon: "type", run: () => void copy(title || book.title.pretty, t("bookmenu.copied")) },
      { key: "id", label: `${t("bookmenu.copyId")} · ${book.id}`, icon: "hash", run: () => void copy(String(book.id), t("bookmenu.copied")) },
      ...(sheet && typeof navigator.share === "function"
        ? [{ key: "share", label: t("bookmenu.share"), icon: "send" as const, run: () => void navigator.share({ title: title || book.title.pretty, url: bookUrl(book) }).catch(() => undefined) }]
        : []),
    ],
  ];

  const item = (it: Item) => (
    <button
      key={it.key}
      type="button"
      role="menuitem"
      className={`${sheet ? "bm-item" : "dk-ctx-item"}${it.danger ? " is-danger" : ""}${armed === it.key ? " is-armed" : ""}`}
      disabled={it.disabled}
      onClick={() => {
        if (it.confirm && armed !== it.key) return setArmed(it.key);
        onClose();
        void it.run();
      }}
    >
      <Icon name={it.icon} size={sheet ? 19 : 16} solid={it.solid} />
      <span>{armed === it.key && it.confirm ? it.confirm : it.label}</span>
    </button>
  );

  return createPortal(
    sheet ? (
      <div className="nt-sheet-host bm-host" {...dismiss}>
        <div ref={panel} className="nt-sheet bm-sheet" role="menu">
          <div className="bm-head">
            <b>{title || book.title.pretty}</b>
            <span>#{book.id}</span>
          </div>
          {groups.map((items, g) => (
            <div key={g} className="bm-group">
              {items.map(item)}
            </div>
          ))}
        </div>
      </div>
    ) : (
      <div className="bm-catch" {...dismiss}>
        <div ref={panel} className="dk-ctx bm-ctx" role="menu" style={pos ?? { left: at.x, top: at.y, visibility: "hidden" }} onContextMenu={(e) => e.preventDefault()}>
          {groups.map((items, g) => (
            <div key={g} className="dk-ctx-group">
              {items.map(item)}
            </div>
          ))}
        </div>
      </div>
    ),
    document.body,
  );
}
