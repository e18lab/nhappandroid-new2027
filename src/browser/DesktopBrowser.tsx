/**
 * ПК-версия MoeLibre — браузер: сверху заголовок окна со строкой вкладок, под ним содержимое выбранной вкладки.
 * Каждая вкладка — свой роутер в памяти со своей историей и свой каркас (`Shell`); неактивные вкладки
 * остаются смонтированными, но не рисуются (`is-hidden-tab`), поэтому при переключении ничего
 * не перезагружается и прокрутка на месте. Общие для окна вещи (окно входа, уведомления о загрузках,
 * обновления) — один раз здесь, а не в каждой вкладке.
 *
 * Клавиши: Ctrl+T — новая вкладка, Ctrl+W — закрыть, Ctrl+Shift+T — вернуть закрытую,
 * Ctrl+Tab / Ctrl+Shift+Tab — соседняя, Ctrl+1…8 — по номеру, Ctrl+9 — последняя, Ctrl+R / F5 — перезагрузить вкладку.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { startAutoUpdate } from "../lib/ota";
import { DesktopTitleBar } from "../shell/DesktopChrome";
import { DownloadNotifier } from "../shell/DownloadBanner";
import { LoginHost } from "../shell/LoginModal";
import { MlLoginHost } from "../shell/MlLoginModal";
import { Shell } from "../shell/Shell";
import { isWindowRoute } from "../shell/windowRoutes";
import {
  activateTabAt,
  closeTab,
  devicePath,
  cycleTab,
  getActiveTabId,
  openTab,
  reloadTab,
  reopenClosedTab,
  setActiveRouter,
  TabActiveContext,
  TabIdContext,
  tabReloadKey,
  updateTabPath,
  useActiveTabId,
  useTabReloads,
  useTabs,
} from "./tabs";

export function DesktopBrowser({ routes }: { routes: ReactNode }) {
  const tabs = useTabs();
  const active = useActiveTabId();
  useTabReloads();

  // Обновления интерфейса по воздуху — один раз на окно (lib/ota.ts)
  useEffect(() => startAutoUpdate(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        reloadTab(getActiveTabId());
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      // По коду клавиши — чтобы работало и в русской раскладке
      const code = e.code;
      if (code === "KeyT" && e.shiftKey) reopenClosedTab();
      else if (code === "KeyT") openTab();
      else if (code === "KeyW") closeTab(getActiveTabId());
      else if (code === "KeyR") reloadTab(getActiveTabId());
      else if (key === "tab") cycleTab(e.shiftKey ? -1 : 1);
      else if (/^Digit[1-9]$/.test(code)) activateTabAt(Number(code.slice(5)));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app ax-app ax-desk">
      <DesktopTitleBar />
      {/* Панели — в постоянном порядке (по id), а не как в строке вкладок: перетаскивание вкладки не должно
          переставлять DOM — при переносе узла браузер сбрасывает прокрутку. Панели лежат в одной ячейке. */}
      {[...tabs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((tab) => (
        <TabActiveContext.Provider key={tabReloadKey(tab.id)} value={tab.id === active}>
          <TabIdContext.Provider value={tab.id}>
            <MemoryRouter initialEntries={[devicePath(tab.path, true)]}>
              <TabBridge id={tab.id} active={tab.id === active} path={tab.path} />
              <Shell embedded active={tab.id === active}>
                {routes}
              </Shell>
            </MemoryRouter>
          </TabIdContext.Provider>
        </TabActiveContext.Provider>
      ))}
      <DownloadNotifier />
      <LoginHost />
      <MlLoginHost />
    </div>
  );
}

/**
 * Связь роутера вкладки с остальным окном: запоминает адрес вкладки, отдаёт заголовку окна роутер выбранной
 * и идёт за адресом, пришедшим из облака (вкладку открыли на другом устройстве на другой странице).
 */
function TabBridge({ id, active, path }: { id: string; active: boolean; path: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const lastPath = useRef(path);

  // Адрес во вкладке сменился не здесь — перейти. Реагируем только на смену `path`: сразу после своего
  // перехода он ещё старый, и без этой проверки вкладка вернулась бы назад.
  useEffect(() => {
    if (path === lastPath.current) return;
    lastPath.current = path;
    if (isWindowRoute(location.pathname)) return;
    const want = devicePath(path, true);
    if (want !== location.pathname + location.search) navigate(want);
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isWindowRoute(location.pathname)) updateTabPath(id, location.pathname + location.search);
  }, [id, location.pathname, location.search]);

  useEffect(() => {
    if (active) setActiveRouter({ location: { pathname: location.pathname, search: location.search }, navigate });
  }, [active, location.pathname, location.search, navigate]);

  return null;
}
