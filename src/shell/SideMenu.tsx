/**
 * Левое меню телефона (вместо логотипа в шапке) — в духе боковой панели браузера:
 *  - сверху аккаунт MoeLibre (облако, аккаунты) и настройки приложения;
 *  - как в браузере: «назад / вперёд / обновить» и адрес открытой страницы на сайте (нажатие копирует,
 *    стрелка — открыть в браузере), как адресная строка на ПК;
 *  - закреплённые вкладки — плитками (значок ресурса с аватаром аккаунта вкладки);
 *  - «Новая вкладка» (с выбором аккаунта), открытые вкладки списком, «Очистить» — закрыть незакреплённые;
 *  - у выбранной вкладки «•••» (закрепить, копия, закрыть), у любой — долгое нажатие;
 *  - внизу — все вкладки сеткой.
 * Открывается кнопкой в шапке, закрывается тапом по затемнению, смахиванием влево или «Назад».
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import { RESOURCES, resourceById } from "../browser/resources";
import { ResourceMark, tabTitle } from "../browser/TabStrip";
import {
  activateTab,
  closeTab,
  closeUnpinnedTabs,
  devicePath,
  duplicateTab,
  getTabs,
  reloadTab,
  splitPath,
  togglePinTab,
  useActiveTabId,
  useTabs,
  type BrowserTab,
} from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { useCloudState } from "../lib/cloudSync";
import { useMl } from "../lib/mlid";
import { useBrowseFilters } from "../lib/browseFilters";
import { useNhAccounts, useSavedNhProfiles } from "../lib/nhAccounts";
import { webUrl } from "../lib/siteUrl";
import { getItem, subscribe } from "../lib/storage";
import { HOME_TAB_KEY } from "../screens/homeTabs";
import { isWindowRoute } from "./windowRoutes";
import { Icon } from "../ui";
import { useBackHandler } from "./androidBack";
import { openMlLogin } from "./MlLoginModal";
import { addNhAccountInNewTab, NewTabAccountList, NhAvatar, openTabWithAccount } from "./TabAccount";

// ─── Открыто / закрыто ───────────────────────────────────────────────────────

let open = false;
const listeners = new Set<() => void>();
function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}
export const openSideMenu = () => setOpen(true);
export const closeSideMenu = () => setOpen(false);

function useSideMenuOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
  );
}

/** Кнопка меню в шапке — на месте логотипа; число вкладок в уголке. */
export function SideMenuButton() {
  const { t } = useI18n();
  const count = useTabs().length;
  return (
    <button type="button" className="lm-btn" aria-label={t("sidemenu.open")} onClick={openSideMenu}>
      <Icon name="menu" size={22} />
      <span className="lm-btn-count">{count > 99 ? "99+" : count}</span>
    </button>
  );
}

// ─── Меню ────────────────────────────────────────────────────────────────────

/** Сдвиг пальца влево, после которого меню закрывается. */
const SWIPE_CLOSE_PX = 70;

export function SideMenu() {
  const isOpen = useSideMenuOpen();
  // Держим смонтированным до конца анимации закрытия
  const [shown, setShown] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setShown(true);
    else {
      const timer = window.setTimeout(() => setShown(false), 220);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);
  useBackHandler(isOpen, closeSideMenu);
  if (!shown) return null;
  return <SideMenuPanel closing={!isOpen} />;
}

/** Адрес открытой во вкладке страницы на сайте; `local` — адрес внутри приложения, если на сайте её нет. */
function useSiteAddress(): { url: string | null; local: string } {
  const { pathname: here, search: hereSearch } = useLocation();
  const tabs = useTabs();
  const active = useActiveTabId();
  const homeTab = useSyncExternalStore((cb) => subscribe((key) => key === HOME_TAB_KEY && cb()), () => getItem(HOME_TAB_KEY) ?? "latest");
  useBrowseFilters();
  // Поверх страницы открыто окно (настройки, профиль MoeLibre…) — адрес страницы под ним
  const { pathname, search } = isWindowRoute(here) ? splitPath(tabs.find((x) => x.id === active)?.path ?? "/") : { pathname: here, search: hereSearch };
  return { url: webUrl(pathname, search, homeTab), local: `moelibre:/${pathname === "/" ? `/${homeTab}` : pathname}` };
}

/** Страница в браузере устройства (в приложении — через opener, иначе новая вкладка). */
async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch(() => undefined);
  } else window.open(url, "_blank", "noopener");
}

/** «Назад / вперёд / обновить» и адресная строка. */
function BrowserBar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const active = useActiveTabId();
  const { url, local } = useSiteAddress();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [url]);

  const copy = () => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="lm-browser">
      <div className="lm-nav">
        <button type="button" aria-label={t("common.back")} onClick={() => navigate(-1)}>
          <Icon name="arrow-left" size={20} />
        </button>
        <button type="button" aria-label={t("common.nextPage")} onClick={() => navigate(1)}>
          <Icon name="arrow-right" size={20} />
        </button>
        <button
          type="button"
          aria-label={t("common.retry")}
          onClick={() => {
            closeSideMenu();
            reloadTab(active);
          }}
        >
          <Icon name="refresh-cw" size={18} />
        </button>
      </div>
      <div className={url ? "lm-url" : "lm-url is-local"}>
        <button type="button" className="lm-url-text" disabled={!url} onClick={copy}>
          {url ? <Icon name={copied ? "check" : "lock"} size={13} /> : <img src={logo} alt="" />}
          <span>{copied ? t("sidemenu.copied") : (url ?? local).replace(/^https:\/\//, "")}</span>
        </button>
        {url && (
          <button type="button" className="lm-url-btn" aria-label={t("sidemenu.copyLink")} onClick={copy}>
            <Icon name="copy" size={16} />
          </button>
        )}
        {url && (
          <button type="button" className="lm-url-btn" aria-label={t("sidemenu.openInBrowser")} onClick={() => void openExternal(url)}>
            <Icon name="arrow-up-right" size={17} />
          </button>
        )}
      </div>
    </div>
  );
}

function SideMenuPanel({ closing }: { closing: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tabs = useTabs();
  const active = useActiveTabId();
  const profiles = useSavedNhProfiles();
  // Аккаунты, чьего профиля на устройстве нет (только привязаны к MoeLibre), — хотя бы по нику
  const known = useNhAccounts();
  const { account: ml } = useMl();
  const cloud = useCloudState();
  const [picking, setPicking] = useState(false);
  const [actions, setActions] = useState<BrowserTab | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);

  const pinned = tabs.filter((x) => x.pinned);
  const others = tabs.filter((x) => !x.pinned);

  const go = (path: string) => {
    closeSideMenu();
    navigate(path);
  };

  const pick = (id: string) => {
    closeSideMenu();
    activateTab(id);
    // Уже выбранная — вернуться на её страницу (могли уйти в настройки и т. п.)
    if (id === active) navigate(devicePath(getTabs().find((x) => x.id === id)?.path ?? "/", false), { replace: true });
  };

  // Смахнуть влево — закрыть (панель едет за пальцем)
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(e.clientY - d.y) > 12) return void (drag.current = null);
      if (dx > -12) return;
      d.on = true;
    }
    d.dx = Math.min(0, dx);
    if (panel.current) {
      panel.current.style.transition = "none";
      panel.current.style.transform = `translateX(${d.dx}px)`;
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on || !panel.current) return;
    panel.current.style.transition = "";
    panel.current.style.transform = "";
    if (d.dx < -SWIPE_CLOSE_PX) closeSideMenu();
  };

  const accountOf = (tab: BrowserTab) => (tab.account ? profiles[String(tab.account)] : undefined);
  const mark = (tab: BrowserTab, size = 18) => {
    const p = accountOf(tab);
    return (
      <span className="lm-mark">
        <ResourceMark res={resourceById(tab.resource)} />
        {tab.account != null && (
          <NhAvatar src={p?.avatar_url} name={p?.username ?? known.find((a) => a.id === tab.account)?.username} size={size * 0.7} className="lm-mark-acc" />
        )}
      </span>
    );
  };

  const cloudLine = !ml ? t("sidemenu.mlSub") : cloud.enabled ? (cloud.status === "online" ? t("mlcloud.online") : t("mlcloud.connecting")) : t("mlcloud.off");

  return (
    <div className={closing ? "lm-host is-closing" : "lm-host"}>
      <div className="lm-dim" onClick={closeSideMenu} />
      <div ref={panel} className="lm-panel" role="dialog" aria-label={t("sidemenu.title")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* Аккаунт MoeLibre и настройки */}
        <div className="lm-head">
          <button type="button" className="lm-ml" onClick={() => (ml ? go("/mlid") : (closeSideMenu(), openMlLogin()))}>
            <span className="lm-ml-ava">
              {ml?.avatar_url ? <img src={ml.avatar_url} alt="" referrerPolicy="no-referrer" /> : <img src={logo} alt="" />}
              {ml && cloud.enabled && <i className={`lm-ml-dot is-${cloud.status}`} aria-hidden />}
            </span>
            <span className="lm-ml-text">
              <b>{ml ? ml.display_name || "MoeLibre" : t("sidemenu.mlSignIn")}</b>
              <span>{cloudLine}</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
          <button type="button" className="lm-icon" aria-label={t("menu.settings")} onClick={() => go("/settings")}>
            <Icon name="settings" size={21} />
          </button>
        </div>

        <BrowserBar />

        <div className="lm-scroll">
          {/* Закреплённые — плитками */}
          {pinned.length > 0 && (
            <div className="lm-pins">
              {pinned.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === active ? "lm-pin is-active" : "lm-pin"}
                  title={tabTitle(tab.path, resourceById(tab.resource), t)}
                  onClick={() => pick(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActions(tab);
                  }}
                >
                  {mark(tab, 22)}
                </button>
              ))}
            </div>
          )}

          <div className="lm-section">
            <span>{t("tabs.title")}</span>
            {others.length > 0 && (
              <button type="button" onClick={closeUnpinnedTabs}>
                {t("sidemenu.clear")}
              </button>
            )}
          </div>

          <button type="button" className="lm-row is-new" onClick={() => setPicking(true)}>
            <span className="lm-row-icon">
              <Icon name="plus" size={20} />
            </span>
            <span className="lm-row-title">{t("tabs.new")}</span>
          </button>

          {others.map((tab) => {
            const res = resourceById(tab.resource);
            const isActive = tab.id === active;
            const p = accountOf(tab);
            return (
              <div
                key={tab.id}
                className={isActive ? "lm-row is-active" : "lm-row"}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActions(tab);
                }}
              >
                <button type="button" className="lm-row-main" onClick={() => pick(tab.id)}>
                  <span className="lm-row-icon">{mark(tab)}</span>
                  <span className="lm-row-title">
                    {tabTitle(tab.path, res, t)}
                    {isActive && <small>{tab.account ? (p?.username ?? `#${tab.account}`) : t("tabs.guest")}</small>}
                  </span>
                </button>
                {isActive && (
                  <button type="button" className="lm-row-btn" aria-label={t("sidemenu.more")} onClick={() => setActions(tab)}>
                    <Icon name="more-vertical" size={18} />
                  </button>
                )}
                <button type="button" className="lm-row-btn" aria-label={t("tabs.close")} onClick={() => closeTab(tab.id)}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Низ: все вкладки сеткой */}
        <div className="lm-foot">
          <button type="button" onClick={() => go("/tabs")}>
            <Icon name="grid" size={19} />
            <span>{t("sidemenu.allTabs")}</span>
          </button>
        </div>
      </div>

      {picking && (
        <div className="nt-sheet-host" onClick={() => setPicking(false)}>
          <div className="nt-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="nt-sheet-title">{t("tabs.pickAccount")}</div>
            <NewTabAccountList
              onPick={(acc) => {
                setPicking(false);
                closeSideMenu();
                if (acc === "add") addNhAccountInNewTab(RESOURCES[0].id);
                else openTabWithAccount(acc, RESOURCES[0].id);
              }}
            />
          </div>
        </div>
      )}

      {actions && (
        <div className="nt-sheet-host" onClick={() => setActions(null)}>
          <div className="nt-sheet lm-actions" onClick={(e) => e.stopPropagation()}>
            <div className="nt-sheet-title">{tabTitle(actions.path, resourceById(actions.resource), t)}</div>
            {[
              { icon: "bookmark" as const, label: actions.pinned ? t("sidemenu.unpin") : t("sidemenu.pin"), run: () => togglePinTab(actions.id) },
              { icon: "copy" as const, label: t("sidemenu.duplicate"), run: () => duplicateTab(actions.id) },
              { icon: "x" as const, label: t("tabs.close"), run: () => closeTab(actions.id) },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                className="nt-acc"
                onClick={() => {
                  setActions(null);
                  a.run();
                }}
              >
                <span className="nt-acc-icon">
                  <Icon name={a.icon} size={18} />
                </span>
                <span className="nt-acc-text">
                  <b>{a.label}</b>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
