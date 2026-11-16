/**
 * Верхняя строка — перенос `components/SearchBar.tsx` (ветка master / релиз 1.3.1).
 * Слева «меню» на главной или «назад» на остальных (долгое нажатие — шторка «Назад»),
 * по центру заголовок экрана, справа поиск, меню фильтров (язык, страницы, дата, сортировка) и теги.
 */
import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useBrowseFilters } from "../lib/browseFilters";
import { useLangPref } from "../lib/langPrefs";
import { useMe } from "../lib/session";
import { englishOf, useTranslatedTitle } from "../lib/titleTranslations";
import { CatalogFilterButton } from "./CatalogFilter";
import { CloudButton } from "./CloudButton";
import { Icon, NhModal, useLongPress } from "../ui";
import { routeIcon, routeTitle } from "./routeTitle";
import { HISTORY_MENU_MAX, useBackStack } from "./HistoryMenu";

/** Первый сегмент пути — как hasSeg в старом. */
function section(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/** Экраны без правых иконок (hideRight в старом). */
const HIDE_RIGHT = new Set(["mlid", "accounts", "tabs", "settings", "tags", "book", "profile", "community", "favorites", "favorites-online", "uikit", "image-search", "characters"]);

export function TopBar({ onOpenMenu, slotRef }: { onOpenMenu: () => void; /** Слот панели страницы (`PageBar.tsx`). */ slotRef?: (el: HTMLElement | null) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [backOpen, setBackOpen] = useState(false);
  useBrowseFilters();

  const me = useMe();
  const seg = section(pathname);
  const isHome = seg === "";
  const q = params.get("query") ?? "";
  // Книга: название по настройке «Названия книг на языке интерфейса» (как в заголовке экрана книги)
  const bookId = seg === "book" ? Number(pathname.split("/")[2]) || 0 : 0;
  const titlesOn = useLangPref("titles");
  const bookTr = useTranslatedTitle(bookId);
  const rawTitle = params.get("title") ?? "";
  const bookTitle = titlesOn ? bookTr || englishOf(rawTitle) || rawTitle : rawTitle;

  const title = routeTitle(pathname + (q && seg === "explore" ? `?query=${encodeURIComponent(q)}` : ""), t, { meId: me?.id, bookTitle: bookTitle || undefined });

  // Удержание «назад» — страницы позади, ближняя первой: нажали — назад сразу на неё
  const backStack = useBackStack();
  const [backItems, setBackItems] = useState<{ key: string; label: string; icon: ReturnType<typeof routeIcon>; steps: number }[]>([]);
  const backLong = useLongPress(() => {
    const stack = backStack().slice(0, -1).reverse().slice(0, HISTORY_MENU_MAX);
    setBackItems(
      stack.map((l, k) => {
        const path = l.pathname + l.search;
        return { key: `${l.key}-${k}`, label: routeTitle(path, t, { meId: me?.id, short: true }), icon: routeIcon(path), steps: k + 1 };
      }),
    );
    setBackOpen(true);
  });
  const hideRight = HIDE_RIGHT.has(seg);
  const hideSearchFilter = seg === "recommendations";

  return (
    <header className="topbar">
      {isHome ? (
        <button type="button" className="topbar-btn" aria-label={t("menu.open")} onClick={onOpenMenu}>
          <Icon name="menu" size={22} />
        </button>
      ) : (
        <button
          type="button"
          className="topbar-btn"
          aria-label={t("common.back")}
          onPointerDown={backLong.start}
          onPointerUp={backLong.cancel}
          onPointerLeave={backLong.cancel}
          onClick={() => {
            if (!backLong.fired()) navigate(-1);
          }}
        >
          <Icon name="arrow-left" size={20} />
        </button>
      )}
      <h1 className="topbar-title">{title}</h1>

      {!hideRight && (
        <div className="topbar-right">
          {me && <CloudButton />}
          {!hideSearchFilter && (
            <button
              type="button"
              className="topbar-btn"
              aria-label={t("menu.search")}
              onClick={() => navigate(q ? `/search?query=${encodeURIComponent(q)}` : "/search")}
            >
              <Icon name="search" size={18} />
            </button>
          )}
          {!hideSearchFilter && (
            <CatalogFilterButton
              trigger={({ onPress }) => (
                <button type="button" className="topbar-btn topbar-accent" aria-label={t("explore.filter.sortTitle")} onClick={onPress}>
                  <Icon name="filter" size={18} />
                </button>
              )}
            />
          )}
          <button type="button" className="topbar-btn topbar-accent" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
            <Icon name="tag" size={18} />
          </button>
        </div>
      )}
      {/* Элементы страницы (действия книги…) — справа на ПК, отдельной строкой на телефоне */}
      <div className="topbar-slot" ref={slotRef} />

      <NhModal visible={backOpen} onClose={() => setBackOpen(false)} title={t("common.back")} sheetStyle={{ background: "var(--search-bg)" }}>
        <div className="back-sheet">
          {backItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="back-sheet-row"
              onClick={() => {
                setBackOpen(false);
                navigate(-item.steps);
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="back-sheet-row"
            onClick={() => {
              setBackOpen(false);
              navigate("/", { replace: true });
            }}
          >
            <Icon name="home" size={18} />
            <span>{t("searchBar.backHome")}</span>
          </button>
        </div>
      </NhModal>
    </header>
  );
}
