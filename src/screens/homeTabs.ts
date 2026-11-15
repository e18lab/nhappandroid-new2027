/**
 * Вкладки главной: список (без содержимого) и связь с заголовком окна ПК.
 * На ПК полоса вкладок стоит в заголовке окна (как в Steam) и видна на любом экране; лента страниц — на главной.
 * Главная отдаёт заголовку состояние своей ленты (`setDeskPager`), пока смонтирована.
 */
import { useSyncExternalStore } from "react";
import type { usePager } from "../ui";

export const HOME_TAB_KEY = "ui.home.tab";

export interface HomeTabMeta {
  key: string;
  labelKey: string;
  needsLogin?: boolean;
  desktopOnly?: boolean;
}

export const HOME_TABS: HomeTabMeta[] = [
  { key: "latest", labelKey: "home.tabs.latest" },
  // На телефоне сообщество — в нижней панели, на ПК её нет
  { key: "community", labelKey: "nav.community", desktopOnly: true },
  { key: "recommendations", labelKey: "menu.recommendations" },
  { key: "downloaded", labelKey: "menu.downloaded" },
  { key: "favorites", labelKey: "menu.favorites" },
  { key: "online", labelKey: "menu.favoritesOnline", needsLogin: true },
  { key: "history", labelKey: "menu.history" },
  { key: "tags", labelKey: "menu.tags" },
];

export function homeTabs(loggedIn: boolean, desktop: boolean): HomeTabMeta[] {
  return HOME_TABS.filter((x) => (!x.needsLogin || loggedIn) && (!x.desktopOnly || desktop));
}

export type HomePagerState = ReturnType<typeof usePager>;

let deskPager: HomePagerState | null = null;
const listeners = new Set<() => void>();

export function getDeskPager(): HomePagerState | null {
  return deskPager;
}

export function setDeskPager(p: HomePagerState | null): void {
  if (deskPager === p) return;
  deskPager = p;
  for (const l of listeners) l();
}

/** Лента главной, если она смонтирована (на ПК). */
export function useDeskPager(): HomePagerState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getDeskPager,
  );
}
