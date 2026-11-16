/**
 * Название страницы по адресу — для заголовка внутренних экранов (`TopBar`) и списка истории «назад / вперёд».
 */
import { cachedCard } from "../lib/bookCards";
import { HOME_TABS } from "../screens/homeTabs";
import type { IconName } from "../ui";

type T = (k: string, p?: Record<string, string | number>) => string;

export interface RouteTitleOptions {
  /** id своего аккаунта nhentai — свой профиль называется «Профиль». */
  meId?: number | null;
  /** Название книги (уже переведённое); нет — из кэша карточек. */
  bookTitle?: string;
  /** Раздел главной (`latest`, `favorites`…). */
  homeTab?: string;
  /** Книга — только название, без `#id - `. */
  short?: boolean;
}

export function routeTitle(path: string, t: T, o: RouteTitleOptions = {}): string {
  const at = path.indexOf("?");
  const pathname = at < 0 ? path : path.slice(0, at);
  const params = new URLSearchParams(at < 0 ? "" : path.slice(at));
  const parts = pathname.split("/");
  const seg = parts[1] ?? "";
  const q = params.get("query")?.trim() ?? "";
  switch (seg) {
    case "": {
      if (q) return `${t("search.results")}: ${q}`;
      const tab = o.homeTab && HOME_TABS.find((x) => x.key === o.homeTab);
      return tab ? t(tab.labelKey) : t("menu.home");
    }
    case "explore":
    case "search":
      return q ? `${t("search.results")}: ${q}` : t("menu.explore");
    case "favorites":
      return t("menu.favorites");
    case "favorites-online":
      return t("menu.favoritesOnline");
    case "downloaded":
      return t("menu.downloaded");
    case "recommendations":
      return t("menu.recommendations");
    case "image-search":
      return t("search.imageSearchResultsTitle");
    case "characters":
      return t("menu.characters");
    case "history":
      return t("menu.history");
    case "community":
      return t("nav.community");
    case "settings":
      return parts[2] ? t(`settings.section.${parts[2]}`) : t("menu.settings");
    case "book":
    case "read": {
      const id = parts[2] ?? "";
      const title = o.bookTitle || params.get("title") || cachedCard(Number(id))?.title || "";
      if (o.short) return title || `#${id}`;
      return title ? `#${id} - ${title}` : `#${id}`;
    }
    case "tags":
      return t("menu.tags");
    case "profile": {
      const [, , pid, pslug, sub] = parts;
      if (sub === "edit") return t("profile.edit.title");
      return o.meId != null && String(o.meId) === pid ? t("menu.profile") : decodeURIComponent(pslug ?? "");
    }
    case "accounts":
      return pathname.endsWith("/edit") ? t("profile.edit.title") : t("accounts.title");
    case "tabs":
      return t("tabs.title");
    case "mlid":
      return parts[3] ? t(`mlcloud.${parts[3]}`) : t("mlid.account");
    case "uikit":
      return t("uikit.title");
    default:
      return "MoeLibre";
  }
}

/** Значок страницы в списке истории. */
export function routeIcon(path: string, homeTab?: string): IconName {
  const seg = path.split(/[/?]/)[1] ?? "";
  if (seg === "" && path.includes("query=")) return "search";
  if (seg === "") {
    const byTab: Record<string, IconName> = { favorites: "bookmark", online: "heart", history: "clock", downloaded: "download", tags: "tag", community: "users", recommendations: "star" };
    return (homeTab && byTab[homeTab]) || "home";
  }
  const bySeg: Record<string, IconName> = {
    book: "book",
    read: "book-open",
    explore: "search",
    search: "search",
    "image-search": "image",
    favorites: "bookmark",
    "favorites-online": "heart",
    downloaded: "download",
    history: "clock",
    recommendations: "star",
    community: "users",
    characters: "users",
    settings: "settings",
    tags: "tag",
    profile: "user",
    accounts: "user",
    mlid: "cloud",
    tabs: "copy",
  };
  return bySeg[seg] ?? "file-text";
}
