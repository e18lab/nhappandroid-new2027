/**
 * Левое меню телефона (вместо логотипа в шапке) — в духе боковой панели браузера:
 *  - сверху аккаунт MoeLibre (облако, аккаунты) и настройки приложения;
 *  - закреплённые вкладки — плитками (значок ресурса с аватаром аккаунта вкладки);
 *  - «Новая вкладка» (с выбором аккаунта), открытые вкладки списком, «Очистить» — закрыть незакреплённые;
 *  - у выбранной вкладки «•••» (закрепить, копия, закрыть), у любой — долгое нажатие;
 *  - внизу — все вкладки сеткой.
 * Открывается кнопкой в шапке, закрывается тапом по затемнению, смахиванием влево или «Назад».
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
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
  togglePinTab,
  useActiveTabId,
  useTabs,
  type BrowserTab,
} from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { useCloudState } from "../lib/cloudSync";
import { useMl } from "../lib/mlid";
import { useSavedNhProfiles } from "../lib/nhAccounts";
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
    <button type="button" className="sm-btn" aria-label={t("sidemenu.open")} onClick={openSideMenu}>
      <Icon name="menu" size={22} />
      <span className="sm-btn-count">{count > 99 ? "99+" : count}</span>
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

function SideMenuPanel({ closing }: { closing: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tabs = useTabs();
  const active = useActiveTabId();
  const profiles = useSavedNhProfiles();
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
      <span className="sm-mark">
        <ResourceMark res={resourceById(tab.resource)} />
        {tab.account != null && <NhAvatar src={p?.avatar_url} name={p?.username} size={size * 0.7} className="sm-mark-acc" />}
      </span>
    );
  };

  const cloudLine = !ml ? t("sidemenu.mlSub") : cloud.enabled ? (cloud.status === "online" ? t("mlcloud.online") : t("mlcloud.connecting")) : t("mlcloud.off");

  return (
    <div className={closing ? "sm-host is-closing" : "sm-host"}>
      <div className="sm-dim" onClick={closeSideMenu} />
      <div ref={panel} className="sm-panel" role="dialog" aria-label={t("sidemenu.title")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* Аккаунт MoeLibre и настройки */}
        <div className="sm-head">
          <button type="button" className="sm-ml" onClick={() => (ml ? go("/mlid") : (closeSideMenu(), openMlLogin()))}>
            <span className="sm-ml-ava">
              {ml?.avatar_url ? <img src={ml.avatar_url} alt="" referrerPolicy="no-referrer" /> : <img src={logo} alt="" />}
              {ml && cloud.enabled && <i className={`sm-ml-dot is-${cloud.status}`} aria-hidden />}
            </span>
            <span className="sm-ml-text">
              <b>{ml ? ml.display_name || "MoeLibre" : t("sidemenu.mlSignIn")}</b>
              <span>{cloudLine}</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
          <button type="button" className="sm-icon" aria-label={t("menu.settings")} onClick={() => go("/settings")}>
            <Icon name="settings" size={21} />
          </button>
        </div>

        <div className="sm-scroll">
          {/* Закреплённые — плитками */}
          {pinned.length > 0 && (
            <div className="sm-pins">
              {pinned.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === active ? "sm-pin is-active" : "sm-pin"}
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

          <div className="sm-section">
            <span>{t("tabs.title")}</span>
            {others.length > 0 && (
              <button type="button" onClick={closeUnpinnedTabs}>
                {t("sidemenu.clear")}
              </button>
            )}
          </div>

          <button type="button" className="sm-row is-new" onClick={() => setPicking(true)}>
            <span className="sm-row-icon">
              <Icon name="plus" size={20} />
            </span>
            <span className="sm-row-title">{t("tabs.new")}</span>
          </button>

          {others.map((tab) => {
            const res = resourceById(tab.resource);
            const isActive = tab.id === active;
            const p = accountOf(tab);
            return (
              <div
                key={tab.id}
                className={isActive ? "sm-row is-active" : "sm-row"}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActions(tab);
                }}
              >
                <button type="button" className="sm-row-main" onClick={() => pick(tab.id)}>
                  <span className="sm-row-icon">{mark(tab)}</span>
                  <span className="sm-row-title">
                    {tabTitle(tab.path, res, t)}
                    {isActive && <small>{tab.account ? (p?.username ?? `#${tab.account}`) : t("tabs.guest")}</small>}
                  </span>
                </button>
                {isActive && (
                  <button type="button" className="sm-row-btn" aria-label={t("sidemenu.more")} onClick={() => setActions(tab)}>
                    <Icon name="more-vertical" size={18} />
                  </button>
                )}
                <button type="button" className="sm-row-btn" aria-label={t("tabs.close")} onClick={() => closeTab(tab.id)}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Низ: все вкладки сеткой */}
        <div className="sm-foot">
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
          <div className="nt-sheet sm-actions" onClick={(e) => e.stopPropagation()}>
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
