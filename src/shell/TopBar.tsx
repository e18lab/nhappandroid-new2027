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

/** Первый сегмент пути — как hasSeg в старом. */
function section(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/** Экраны без правых иконок (hideRight в старом). */
const HIDE_RIGHT = new Set(["settings", "tags", "book", "profile", "community", "favorites", "favorites-online", "uikit"]);

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
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

  const title = (() => {
    switch (seg) {
      case "":
        return t("menu.home");
      case "explore":
        return q ? `${t("search.results")}: ${q}` : t("menu.explore");
      case "favorites":
        return t("menu.favorites");
      case "favorites-online":
        return t("menu.favoritesOnline");
      case "downloaded":
        return t("menu.downloaded");
      case "recommendations":
        return t("menu.recommendations");
      case "history":
        return t("menu.history");
      case "community":
        return t("nav.community");
      case "settings": {
        // Страница раздела (/settings/grid …) — его название
        const sub = pathname.split("/")[2];
        return sub ? t(`settings.section.${sub}`) : t("menu.settings");
      }
      case "book":
        return `#${pathname.split("/")[2] ?? ""} - ${bookTitle}`;
      case "tags":
        return t("menu.tags");
      case "profile": {
        const [, , pid, pslug, sub] = pathname.split("/");
        if (sub === "edit") return t("profile.edit.title");
        return me && String(me.id) === pid ? t("menu.profile") : decodeURIComponent(pslug ?? "");
      }
      case "uikit":
        return t("uikit.title");
      default:
        return "NHApp";
    }
  })();

  const backLong = useLongPress(() => setBackOpen(true));
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

      <NhModal visible={backOpen} onClose={() => setBackOpen(false)} title={t("common.back")} sheetStyle={{ background: "var(--search-bg)" }}>
        <div className="back-sheet">
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate(-1);
            }}
          >
            {t("searchBar.backOne")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate(-2);
            }}
          >
            {t("searchBar.backTwo")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate("/", { replace: true });
            }}
          >
            {t("searchBar.backHome")}
          </button>
        </div>
      </NhModal>
    </header>
  );
}
