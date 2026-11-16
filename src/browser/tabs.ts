/**
 * Вкладки браузера MoeLibre (ПК): список открытых вкладок, выбранная вкладка и мост к роутеру выбранной.
 *
 * У каждой вкладки свой роутер в памяти (`DesktopBrowser.tsx`) со своей историей «назад / вперёд»;
 * неактивные вкладки остаются смонтированными — прокрутка и состояние экранов не теряются.
 * Список (`browser.tabs.v1`: ресурс, адрес, аккаунт и фильтры каждой вкладки) лежит в общем хранилище и уходит
 * в облако (часть `tabs`) — один список на все устройства, как одно окно браузера. Аккаунт ресурса и фильтры
 * каталога у каждой вкладки свои (`tabBinding.ts` переносит их в клиент и обратно при смене вкладки). Выбранная вкладка — своя у каждого устройства
 * (`@local.` в облако не уходит). Окна поверх экрана (настройки, профиль, теги) адрес вкладки не меняют.
 */
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { NavigateFunction } from "react-router-dom";
import { getItem, getJSON, setItem, setJSON, subscribeKey } from "../lib/storage";
import { DEFAULT_RESOURCE, RESOURCES } from "./resources";

export interface BrowserTab {
  id: string;
  resource: string;
  /** Адрес страницы во вкладке: путь и параметры (`/book/123`, `/?query=…`). */
  path: string;
  /** Закреплена: стоит слева, узкая (только значок), не закрывается «закрыть другие / справа». */
  pinned?: boolean;
  /** Аккаунт ресурса во вкладке (id nhentai); null — без входа; нет поля — ещё не запомнен. */
  account?: number | null;
  /** Фильтры каталога вкладки: ключ хранилища → значение (null — фильтр снят). */
  filters?: Record<string, string | null>;
  /** История «назад / вперёд» вкладки (только страницы, без окон) — переживает перезапуск и уходит в облако. */
  history?: TabHistory;
}

/**
 * История вкладки: `e` — страницы по порядку (`p` — адрес, `t` — раздел главной, `s` — та же запись роутера,
 * что и предыдущая: сменился только раздел главной), `i` — открытая.
 */
export interface TabHistory {
  e: { p: string; t?: string; s?: 1 }[];
  i: number;
}

const TABS_KEY = "browser.tabs.v1";
const ACTIVE_KEY = "@local.browser.activeTab";

/** Первая вкладка, пока список пуст: постоянный id, чтобы её роутер не пересоздавался. */
const FALLBACK: BrowserTab[] = [{ id: "main", resource: DEFAULT_RESOURCE, path: "/" }];

const newId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function valid(t: unknown): t is BrowserTab {
  if (!t || typeof t !== "object") return false;
  const r = t as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.path === "string" && typeof r.resource === "string" && RESOURCES.some((x) => x.id === r.resource && x.available);
}

let cache: BrowserTab[] | null = null;
subscribeKey(TABS_KEY, () => {
  cache = null;
});

export function getTabs(): BrowserTab[] {
  if (!cache) {
    const raw = getJSON<unknown>(TABS_KEY, null);
    const list = Array.isArray(raw) ? raw.filter(valid) : [];
    cache = list.length ? list : FALLBACK;
  }
  return cache;
}

function setTabs(next: BrowserTab[]): void {
  cache = next;
  setJSON(TABS_KEY, next);
}

export function getActiveTabId(): string {
  const tabs = getTabs();
  const id = getItem(ACTIVE_KEY);
  return id && tabs.some((t) => t.id === id) ? id : tabs[0].id;
}

/** Хуки выбора вкладки: `beforeActivate` — до того, как вкладка станет выбранной (фильтры вкладки — сразу). */
export const tabHooks: { beforeActivate?: (tab: BrowserTab) => void } = {};

export function activateTab(id: string): void {
  if (getItem(ACTIVE_KEY) === id) return;
  const tab = getTabs().find((t) => t.id === id);
  if (tab) tabHooks.beforeActivate?.(tab);
  setItem(ACTIVE_KEY, id);
}

/** Закреплённые — всегда слева, остальные за ними; порядок внутри групп сохраняется. */
function ordered(tabs: BrowserTab[]): BrowserTab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

/**
 * Новая вкладка с ресурсом — справа от `after` (по умолчанию от выбранной, но не среди закреплённых),
 * и она становится выбранной.
 */
export function openTab(resource: string = DEFAULT_RESOURCE, path = "/", after?: string, account?: number | null): void {
  const tabs = getTabs();
  let at = tabs.findIndex((t) => t.id === (after ?? getActiveTabId()));
  const lastPinned = tabs.reduce((n, t, i) => (t.pinned ? i : n), -1);
  at = Math.max(at, lastPinned);
  // Аккаунт и фильтры — как у вкладки, из которой открыли
  const from = tabs.find((t) => t.id === getActiveTabId());
  const tab: BrowserTab = { id: newId(), resource, path, account: account !== undefined ? account : from?.account, filters: from?.filters };
  setTabs([...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)]);
  activateTab(tab.id);
}

/** Копия вкладки (тот же ресурс и адрес) сразу справа от неё. */
export function duplicateTab(id: string): void {
  const tab = getTabs().find((t) => t.id === id);
  if (tab) openTab(tab.resource, tab.path, id, tab.account);
}

// Закрытые вкладки — чтобы вернуть их (Ctrl+Shift+T). Только на это устройство и до перезапуска.
const closed: { tab: BrowserTab; index: number }[] = [];
const CLOSED_LIMIT = 25;

/** Убрать вкладки; если среди них выбранная — выбрать соседнюю; если не осталось ни одной — новая пустая. */
function removeTabs(ids: Set<string>): void {
  const tabs = getTabs();
  const activeId = getActiveTabId();
  const activeAt = tabs.findIndex((t) => t.id === activeId);
  tabs.forEach((tab, index) => ids.has(tab.id) && closed.push({ tab: { ...tab, pinned: false }, index }));
  closed.splice(0, Math.max(0, closed.length - CLOSED_LIMIT));
  const next = tabs.filter((t) => !ids.has(t.id));
  if (!next.length) next.push({ id: newId(), resource: DEFAULT_RESOURCE, path: "/" });
  setTabs(next);
  if (ids.has(activeId)) {
    // Как в Chrome: правая соседняя, если её нет — левая
    const right = tabs.slice(activeAt + 1).find((t) => !ids.has(t.id));
    const left = tabs.slice(0, activeAt).reverse().find((t) => !ids.has(t.id));
    activateTab((right ?? left ?? next[0]).id);
  }
}

/** Закрыть вкладку; закрыли выбранную — выбирается соседняя; последнюю — вместо неё новая пустая. */
export function closeTab(id: string): void {
  if (getTabs().some((t) => t.id === id)) removeTabs(new Set([id]));
}

/** Закрыть все, кроме этой и закреплённых. */
export function closeOtherTabs(id: string): void {
  removeTabs(new Set(getTabs().filter((t) => t.id !== id && !t.pinned).map((t) => t.id)));
}

/** Закрыть вкладки справа от этой (закреплённые не трогаем). */
export function closeTabsToRight(id: string): void {
  const tabs = getTabs();
  const at = tabs.findIndex((t) => t.id === id);
  removeTabs(new Set(tabs.slice(at + 1).filter((t) => !t.pinned).map((t) => t.id)));
}

/** Закрыть все незакреплённые («Очистить» в меню телефона); не осталось ни одной — новая пустая. */
export function closeUnpinnedTabs(): void {
  removeTabs(new Set(getTabs().filter((t) => !t.pinned).map((t) => t.id)));
}

export function canReopenTab(): boolean {
  return closed.length > 0;
}

/** Вернуть последнюю закрытую вкладку на её место. */
export function reopenClosedTab(): void {
  const last = closed.pop();
  if (!last) return;
  const tabs = getTabs();
  const tab = { ...last.tab, id: tabs.some((t) => t.id === last.tab.id) ? newId() : last.tab.id };
  const at = Math.min(Math.max(last.index, tabs.filter((t) => t.pinned).length), tabs.length);
  setTabs([...tabs.slice(0, at), tab, ...tabs.slice(at)]);
  activateTab(tab.id);
}

/** Закрепить / открепить: закреплённая переезжает в конец закреплённых, откреплённая — в начало обычных. */
export function togglePinTab(id: string): void {
  const tabs = getTabs();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  const rest = tabs.filter((t) => t.id !== id);
  const pinned = rest.filter((t) => t.pinned);
  const others = rest.filter((t) => !t.pinned);
  setTabs(tab.pinned ? [...pinned, { ...tab, pinned: false }, ...others] : [...pinned, { ...tab, pinned: true }, ...others]);
}

/** Перетаскивание: поставить вкладку на место `to` (закреплённые остаются среди закреплённых). */
export function moveTab(id: string, to: number): void {
  const tabs = getTabs();
  const from = tabs.findIndex((t) => t.id === id);
  if (from < 0 || from === to) return;
  const next = [...tabs];
  const [tab] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, tab);
  const fixed = ordered(next);
  if (fixed.some((t, i) => t.id !== tabs[i].id)) setTabs(fixed);
}

// Перезагрузка вкладки: её роутер и экраны монтируются заново (номер перезагрузки — часть ключа)
const reloads = new Map<string, number>();
const reloadListeners = new Set<() => void>();
let reloadsVersion = 0;

export function reloadTab(id: string): void {
  reloads.set(id, (reloads.get(id) ?? 0) + 1);
  reloadsVersion++;
  for (const l of reloadListeners) l();
}

export function tabReloadKey(id: string): string {
  return `${id}:${reloads.get(id) ?? 0}`;
}

/** Перерисовка при перезагрузке любой вкладки. */
export function useTabReloads(): number {
  return useSyncExternalStore(
    (cb) => {
      reloadListeners.add(cb);
      return () => {
        reloadListeners.delete(cb);
      };
    },
    () => reloadsVersion,
  );
}

/** Вкладка по номеру (Ctrl+1…8), Ctrl+9 — последняя. */
export function activateTabAt(n: number): void {
  const tabs = getTabs();
  const tab = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (tab) activateTab(tab.id);
}

/** Соседняя вкладка (Ctrl+Tab / Ctrl+Shift+Tab). */
export function cycleTab(step: 1 | -1): void {
  const tabs = getTabs();
  const at = tabs.findIndex((t) => t.id === getActiveTabId());
  activateTab(tabs[(at + step + tabs.length) % tabs.length].id);
}

export function updateTabPath(id: string, path: string): void {
  const tabs = getTabs();
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.path === path) return;
  setTabs(tabs.map((t) => (t.id === id ? { ...t, path } : t)));
}

/** Запомнить историю вкладки. */
export function updateTabHistory(id: string, history: TabHistory): void {
  const tabs = getTabs();
  const tab = tabs.find((t) => t.id === id);
  if (!tab || JSON.stringify(tab.history) === JSON.stringify(history)) return;
  setTabs(tabs.map((t) => (t.id === id ? { ...t, history } : t)));
}

/** Сохранённая история вкладки, если она про её нынешний адрес (адрес могли сменить на другом устройстве). */
export function savedHistory(tab: BrowserTab): TabHistory | null {
  const h = tab.history;
  if (!h || !Array.isArray(h.e) || !Number.isInteger(h.i) || h.i < 0 || h.i >= h.e.length) return null;
  if (!h.e.every((x) => x && typeof x.p === "string" && (x.t == null || typeof x.t === "string"))) return null;
  return devicePath(h.e[h.i].p, true) === devicePath(tab.path, true) ? h : null;
}

/** Записи роутера вкладки из её истории: подряд идущие разделы главной — одна запись. */
export function routerEntries(tab: BrowserTab): { entries: string[]; index: number } {
  const h = savedHistory(tab);
  if (!h) return { entries: [devicePath(tab.path, true)], index: 0 };
  const entries: string[] = [];
  let index = 0;
  h.e.forEach((x, i) => {
    if (!(i > 0 && x.s)) entries.push(devicePath(x.p, true));
    if (i === h.i) index = entries.length - 1;
  });
  return { entries, index };
}

/** Запомнить аккаунт или фильтры вкладки. */
export function updateTabMeta(id: string, patch: Pick<BrowserTab, "account" | "filters">): void {
  const tabs = getTabs();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  const next = { ...tab, ...patch };
  if (JSON.stringify(next) === JSON.stringify(tab)) return;
  setTabs(tabs.map((t) => (t.id === id ? next : t)));
}

export const TABS_STORAGE_KEY = TABS_KEY;
export const ACTIVE_TAB_KEY = ACTIVE_KEY;

export function useTabs(): BrowserTab[] {
  return useSyncExternalStore((cb) => subscribeKey(TABS_KEY, cb), getTabs);
}

export function useActiveTabId(): string {
  return useSyncExternalStore(
    (cb) => {
      const a = subscribeKey(ACTIVE_KEY, cb);
      const b = subscribeKey(TABS_KEY, cb);
      return () => {
        a();
        b();
      };
    },
    getActiveTabId,
  );
}

/**
 * Адрес вкладки для этого устройства. Вкладки общие для ПК и телефона, а поиск устроен по-разному:
 * на телефоне — страница поиска (`/search?query=`), на ПК — поле в заголовке и результаты (`/explore?query=`).
 * Вкладку, пришедшую с другого устройства, открываем так, как принято здесь.
 */
export function devicePath(path: string, desktop: boolean): string {
  const { pathname, search } = splitPath(path);
  const query = new URLSearchParams(search).get("query")?.trim() ?? "";
  if (desktop && pathname === "/search") return query ? `/explore?query=${encodeURIComponent(query)}` : "/";
  if (!desktop && pathname === "/explore" && query && !/[:"]/.test(query)) return `/search?query=${encodeURIComponent(query)}`;
  return path;
}

/** Адрес вкладки на путь и параметры. */
export function splitPath(path: string): { pathname: string; search: string } {
  const at = path.indexOf("?");
  return at < 0 ? { pathname: path, search: "" } : { pathname: path.slice(0, at), search: path.slice(at) };
}

// ─── Роутер выбранной вкладки ─────────────────────────────────────────────────
// Заголовок окна (вкладки разделов, адрес, поиск) стоит вне роутеров вкладок и ходит через этот мост.

export interface ActiveRouter {
  location: { pathname: string; search: string };
  navigate: NavigateFunction;
}

const IDLE_ROUTER: ActiveRouter = { location: { pathname: "/", search: "" }, navigate: (() => {}) as NavigateFunction };
let activeRouter: ActiveRouter = IDLE_ROUTER;
const routerListeners = new Set<() => void>();

/** Роутер выбранной вкладки вне React (отладочный мост). */
export const getActiveRouter = (): ActiveRouter => activeRouter;

export function setActiveRouter(r: ActiveRouter): void {
  activeRouter = r;
  for (const l of routerListeners) l();
}

export function useActiveRouter(): ActiveRouter {
  return useSyncExternalStore(
    (cb) => {
      routerListeners.add(cb);
      return () => {
        routerListeners.delete(cb);
      };
    },
    () => activeRouter,
  );
}

// ─── «Назад / вперёд» по страницам (ПК) ───────────────────────────────────────
// Каркас вкладки (`Shell.tsx`) знает её историю и умеет шагать, пропуская окна (настройки, профиль…):
// кнопки адресной строки ходят только по страницам.

export interface PageHistoryPage {
  /** Номер записи истории — для `go`. */
  i: number;
  path: string;
  /** Раздел главной. */
  tab?: string;
}

export interface PageHistoryNav {
  back(): void;
  forward(): void;
  /** Перейти на запись истории (из `pages`). */
  go(i: number): void;
  canBack: boolean;
  canForward: boolean;
  /** Страницы до открытой (ближняя — первой) и после неё. */
  pages(): { back: PageHistoryPage[]; forward: PageHistoryPage[] };
}
const pageNav = new Map<string, PageHistoryNav>();
const pageNavListeners = new Set<() => void>();
export function setPageHistoryNav(tabId: string, nav: PageHistoryNav | null): void {
  if (nav) pageNav.set(tabId, nav);
  else pageNav.delete(tabId);
  for (const l of pageNavListeners) l();
}
export const getPageHistoryNav = (tabId: string): PageHistoryNav | undefined => pageNav.get(tabId);

/** «Назад / вперёд» вкладки — для кнопок (неактивны, когда идти некуда). */
export function usePageHistoryNav(tabId: string): PageHistoryNav | undefined {
  return useSyncExternalStore(
    (cb) => {
      pageNavListeners.add(cb);
      return () => {
        pageNavListeners.delete(cb);
      };
    },
    () => pageNav.get(tabId),
  );
}

/** id вкладки, в которой рисуется экран (на телефоне — null: дерево одно). */
export const TabIdContext = createContext<string | null>(null);

/**
 * Вкладка, чьи аккаунт и фильтры сейчас в клиенте (`tabBinding.ts`). Меняется раньше, чем выбранная вкладка
 * перерисуется, — чтобы скрытые вкладки не подхватывали чужие фильтры и аккаунт.
 */
let boundTabId: string | null = null;
export const getBoundTabId = () => boundTabId;
export function setBoundTabId(id: string | null): void {
  boundTabId = id;
}

/**
 * Значение из общего состояния (фильтры, аккаунт) для экрана вкладки: пока вкладка не выбрана, оно не меняется —
 * её экраны не перезагружаются, когда фильтры и аккаунт переключаются на другую вкладку. Вернулись — общее
 * состояние снова её, и значение совпадает с прежним: ничего не грузится заново.
 */
export function useBoundValue<T>(value: T): T {
  const id = useContext(TabIdContext);
  const ref = useRef(value);
  if (id === null || boundTabId === null || boundTabId === id) ref.current = value;
  return ref.current;
}

/** Открыта ли вкладка, в которой рисуется экран (на телефоне вкладок нет — всегда да). */
export const TabActiveContext = createContext(true);

export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}
