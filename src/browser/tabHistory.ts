/**
 * ПК: история «назад / вперёд» вкладки браузера для кнопок адресной строки.
 *  - Ходит только по страницам: окна (настройки, профиль, теги) перешагивает — они открываются и закрываются сами.
 *  - Разделы главной (Новое → Закладки) — тоже шаги истории, хотя адрес роутера при этом не меняется.
 *  - Хранится во вкладке (`BrowserTab.history`): переживает перезапуск, перезагрузку вкладки и уходит в облако
 *    вместе со списком вкладок. Роутер вкладки при запуске получает те же записи (`routerEntries`).
 * Своя история повторяет записи роутера: подряд идущие записи с `same` — одна запись роутера (сменился раздел),
 * поэтому шаг на другую запись — `navigate(разница записей роутера)`.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Location, NavigateFunction, NavigationType } from "react-router-dom";
import { IS_DESKTOP } from "../lib/platform";
import { getItem, setItem, subscribeKey } from "../lib/storage";
import { HOME_TAB_KEY } from "../screens/homeTabs";
import { isWindowRoute } from "../shell/windowRoutes";
import { getActiveTabId, getBoundTabId, getTabs, savedHistory, setPageHistoryNav, splitPath, updateTabHistory, type TabHistory } from "./tabs";

interface Entry {
  /** Ключ записи роутера; null — восстановлена из сохранённой истории, роутер на ней ещё не был. */
  key: string | null;
  path: string;
  /** Раздел главной. */
  tab?: string;
  win: boolean;
  /** Та же запись роутера, что и предыдущая. */
  same?: boolean;
}

interface State {
  list: Entry[];
  index: number;
  /** Куда идём кнопками (ждём, пока роутер дойдёт). */
  target: number | null;
}

const MAX = 50;
const SAVE_MS = 400;

const pathOf = (l: { pathname: string; search: string }) => l.pathname + l.search;
const isHome = (path: string) => {
  const { pathname, search } = splitPath(path);
  return pathname === "/" && !new URLSearchParams(search).get("query")?.trim();
};

function homeTabOf(tabId: string): string {
  if (getBoundTabId() === tabId) return getItem(HOME_TAB_KEY) ?? "latest";
  return getTabs().find((t) => t.id === tabId)?.filters?.[HOME_TAB_KEY] ?? "latest";
}

/** Начало и конец записи роутера, в которую входит `i`. */
function runOf(list: Entry[], i: number): [number, number] {
  let a = i;
  while (a > 0 && list[a].same) a--;
  let b = i;
  while (b + 1 < list.length && list[b + 1].same) b++;
  return [a, b];
}

/** Номер записи роутера. */
const routerIndex = (list: Entry[], i: number) => list.slice(1, i + 1).filter((e) => !e.same).length;

function trim(s: State) {
  const extra = s.list.length - MAX;
  if (extra <= 0) return;
  s.list = s.list.slice(extra);
  s.list[0] = { ...s.list[0], same: false };
  s.index = Math.max(0, s.index - extra);
  if (s.target != null) s.target = s.target >= extra ? s.target - extra : null;
}

function initial(tabId: string, loc: Location): State {
  const path = pathOf(loc);
  const here: Entry = { key: loc.key, path, win: isWindowRoute(loc.pathname), tab: isHome(path) ? homeTabOf(tabId) : undefined };
  const tab = getTabs().find((t) => t.id === tabId);
  const h = tab && savedHistory(tab);
  if (!h || h.e[h.i].p !== path) return { list: [here], index: 0, target: null };
  const list: Entry[] = h.e.map((x, i) => ({ key: null, path: x.p, tab: x.t, win: false, same: i > 0 && !!x.s }));
  const [a, b] = runOf(list, h.i);
  for (let k = a; k <= b; k++) list[k].key = loc.key;
  return { list, index: h.i, target: null };
}

/** Что сохранить: только страницы. */
function toSaved(s: State): TabHistory | null {
  const e: TabHistory["e"] = [];
  let i = -1;
  s.list.forEach((x, k) => {
    if (x.win) return;
    e.push({ p: x.path, ...(x.tab ? { t: x.tab } : {}), ...(x.same && e.length ? { s: 1 as const } : {}) });
    if (k <= s.index) i = e.length - 1;
  });
  if (!e.length) return null;
  return { e, i: Math.max(0, i) };
}

export function useTabHistory(tabId: string | null, location: Location, navType: NavigationType, navigate: NavigateFunction): void {
  const on = IS_DESKTOP && !!tabId;
  const st = useRef<State | null>(null);
  if (on && !st.current) st.current = initial(tabId!, location);
  const applying = useRef(false);
  const changed = useRef<() => void>(() => {});

  // Раздел главной из истории — в общее хранилище (если вкладка сейчас его хозяйка)
  const applyTab = (e: Entry) => {
    if (!e.tab || !isHome(e.path) || getBoundTabId() !== tabId) return;
    if ((getItem(HOME_TAB_KEY) ?? "latest") === e.tab) return;
    applying.current = true;
    try {
      setItem(HOME_TAB_KEY, e.tab);
    } finally {
      applying.current = false;
    }
  };

  // Кнопки и сохранение
  useEffect(() => {
    if (!on) return;
    const id = tabId!;
    let timer = 0;
    const go = (i: number) => {
      const s = st.current!;
      const e = s.list[i];
      if (!e || e.win || i === s.index) return;
      const delta = routerIndex(s.list, i) - routerIndex(s.list, s.index);
      if (delta === 0) {
        s.index = i;
        applyTab(e);
        changed.current();
      } else {
        s.target = i;
        navigate(delta);
      }
    };
    const step = (dir: 1 | -1) => {
      const s = st.current!;
      for (let i = s.index + dir; i >= 0 && i < s.list.length; i += dir) if (!s.list[i].win) return go(i);
    };
    const pages = () => {
      const s = st.current!;
      const page = (i: number) => ({ i, path: s.list[i].path, tab: s.list[i].tab });
      const back = [];
      for (let i = s.index - 1; i >= 0; i--) if (!s.list[i].win) back.push(page(i));
      const forward = [];
      for (let i = s.index + 1; i < s.list.length; i++) if (!s.list[i].win) forward.push(page(i));
      return { back, forward };
    };
    const publish = () => {
      const s = st.current!;
      const page = (from: number, dir: 1 | -1) => {
        for (let i = from + dir; i >= 0 && i < s.list.length; i += dir) if (!s.list[i].win) return true;
        return false;
      };
      setPageHistoryNav(id, { back: () => step(-1), forward: () => step(1), go, pages, canBack: page(s.index, -1), canForward: page(s.index, 1) });
    };
    changed.current = () => {
      publish();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const saved = toSaved(st.current!);
        if (saved) updateTabHistory(id, saved);
      }, SAVE_MS);
    };
    publish();
    return () => {
      window.clearTimeout(timer);
      const saved = toSaved(st.current!);
      if (saved) updateTabHistory(id, saved);
      setPageHistoryNav(id, null);
      changed.current = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, tabId, navigate]);

  // Переходы роутера
  useLayoutEffect(() => {
    if (!on) return;
    const s = st.current!;
    if (s.list[s.index]?.key === location.key) return;
    const path = pathOf(location);
    const entry: Entry = { key: location.key, path, win: isWindowRoute(location.pathname), tab: isHome(path) ? homeTabOf(tabId!) : undefined };
    if (navType === "PUSH") {
      s.list = [...s.list.slice(0, s.index + 1), entry];
      s.index = s.list.length - 1;
      s.target = null;
    } else if (navType === "REPLACE") {
      const [a, b] = runOf(s.list, s.index);
      s.list.splice(a, b - a + 1, { ...entry, same: false });
      s.index = a;
      s.target = null;
    } else {
      let to = -1;
      const t = s.target;
      s.target = null;
      if (t != null && t < s.list.length && (s.list[t].key == null || s.list[t].key === location.key)) to = t;
      else {
        const [a, b] = runOf(s.list, s.index);
        const match = (i: number) => s.list[i].key === location.key;
        // Ушли назад — последняя страница той записи, вперёд — первая
        for (let i = a - 1; i >= 0 && to < 0; i--) if (match(i)) to = i;
        for (let i = b + 1; i < s.list.length && to < 0; i++) if (match(i)) to = runOf(s.list, i)[0];
        // Роутер на записи, где ещё не был (восстановленная история): чаще всего это шаг назад
        if (to < 0 && a > 0 && s.list[a - 1].key == null) to = a - 1;
        else if (to < 0 && b + 1 < s.list.length && s.list[b + 1].key == null) to = b + 1;
      }
      if (to < 0) {
        s.list = [entry];
        s.index = 0;
      } else {
        const [a, b] = runOf(s.list, to);
        for (let k = a; k <= b; k++) s.list[k] = { ...s.list[k], key: location.key, path, win: entry.win };
        s.index = to;
        applyTab(s.list[to]);
      }
    }
    trim(s);
    changed.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navType]);

  // Сменили раздел главной (вкладкой раздела, листанием) — новый шаг истории
  useEffect(() => {
    if (!on) return;
    const id = tabId!;
    return subscribeKey(HOME_TAB_KEY, () => {
      // При смене вкладки раздел пишется в хранилище до того, как она станет выбранной, — это не переход
      if (applying.current || getActiveTabId() !== id || getBoundTabId() !== id) return;
      const s = st.current!;
      const cur = s.list[s.index];
      if (!cur || cur.win || !isHome(cur.path)) return;
      const v = getItem(HOME_TAB_KEY) ?? "latest";
      if (cur.tab === v) return;
      if (cur.tab == null) cur.tab = v;
      else {
        s.list = [...s.list.slice(0, s.index + 1), { key: cur.key, path: cur.path, tab: v, win: false, same: true }];
        s.index++;
        trim(s);
      }
      changed.current();
    });
  }, [on, tabId]);
}
