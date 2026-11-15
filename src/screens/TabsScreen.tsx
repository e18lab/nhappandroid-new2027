/**
 * Вкладки на телефоне (`/tabs`) — как в мобильном браузере: сетка карточек (ресурс, аккаунт, заголовок
 * страницы), выбрать, закрыть, «Новая вкладка». Список тот же, что на ПК, и синхронизируется облаком.
 *
 * `MobileTabBridge` (в каркасе телефона) связывает единственный роутер телефона с выбранной вкладкой:
 * переходы запоминаются в ней, а выбор другой вкладки открывает её адрес.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RESOURCES, resourceById } from "../browser/resources";
import { ResourceMark, tabTitle } from "../browser/TabStrip";
import { activateTab, closeTab, devicePath, getTabs, updateTabPath, useActiveTabId, useTabs } from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { useSavedNhProfiles } from "../lib/nhAccounts";
import { addNhAccountInNewTab, NewTabAccountList, NhAvatar, openTabWithAccount } from "../shell/TabAccount";
import { isWindowRoute } from "../shell/windowRoutes";
import { Icon } from "../ui";

export function TabsScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tabs = useTabs();
  const active = useActiveTabId();
  const profiles = useSavedNhProfiles();
  const [picking, setPicking] = useState(false);

  const pick = (id: string) => {
    activateTab(id);
    // Если вкладка уже выбрана — просто вернуться на её страницу
    if (id === active) navigate(devicePath(getTabs().find((x) => x.id === id)?.path ?? "/", false), { replace: true });
  };

  return (
    <div className="screen-scroll tabs-screen">
      <div className="tabs-grid">
        {tabs.map((tab) => {
          const res = resourceById(tab.resource);
          const p = tab.account ? profiles[String(tab.account)] : undefined;
          return (
            <div key={tab.id} className={tab.id === active ? "tabs-card is-active" : "tabs-card"}>
              <button type="button" className="tabs-card-body" onClick={() => pick(tab.id)}>
                <span className="tabs-card-top">
                  <ResourceMark res={res} />
                  <span className="tabs-card-res">{res.name}</span>
                </span>
                <b className="tabs-card-title">{tabTitle(tab.path, res, t)}</b>
                <span className="tabs-card-acc">
                  <NhAvatar src={p?.avatar_url} name={p?.username} size={20} />
                  <span>{tab.account ? (p?.username ?? `#${tab.account}`) : t("tabs.guest")}</span>
                </span>
              </button>
              <button type="button" className="tabs-card-x" aria-label={t("tabs.close")} onClick={() => closeTab(tab.id)}>
                <Icon name="x" size={16} />
              </button>
            </div>
          );
        })}
        <button type="button" className="tabs-card is-new" onClick={() => setPicking(true)}>
          <Icon name="plus" size={26} />
          <span>{t("tabs.new")}</span>
        </button>
      </div>
      {picking && (
        <div className="nt-sheet-host" onClick={() => setPicking(false)}>
          <div className="nt-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="nt-sheet-title">{t("tabs.pickAccount")}</div>
            <NewTabAccountList
              onPick={(acc) => {
                setPicking(false);
                if (acc === "add") addNhAccountInNewTab(RESOURCES[0].id);
                else openTabWithAccount(acc, RESOURCES[0].id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Кнопка вкладок в шапке телефона: число открытых, как в мобильном браузере. */
export function TabsButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const count = useTabs().length;
  return (
    <button type="button" className="ax-icon-btn tabs-btn" aria-label={t("tabs.count", { n: count })} onClick={() => navigate("/tabs")}>
      <span>{count > 99 ? "99+" : count}</span>
    </button>
  );
}

/** Роутер телефона ↔ выбранная вкладка. */
export function MobileTabBridge() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const active = useActiveTabId();
  const activePath = useTabs().find((x) => x.id === active)?.path ?? "/";
  const bound = useRef(active);
  const lastPath = useRef(activePath);
  const here = pathname + search;

  // Адрес выбранной вкладки сменили на другом устройстве — перейти (свой переход его тоже меняет: тогда он
  // совпадает с текущим адресом, и ничего не происходит)
  useEffect(() => {
    if (activePath === lastPath.current) return;
    lastPath.current = activePath;
    if (bound.current !== active || isWindowRoute(pathname)) return;
    const want = devicePath(activePath, false);
    if (want !== here) navigate(want);
  }, [activePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Выбрали другую вкладку (на экране вкладок или в облаке закрыли текущую) — открыть её страницу
  useEffect(() => {
    if (bound.current === active) return;
    bound.current = active;
    lastPath.current = getTabs().find((x) => x.id === active)?.path ?? "/";
    const tab = getTabs().find((x) => x.id === active);
    const target = tab && devicePath(tab.path, false);
    if (target && target !== here) navigate(target, { replace: isWindowRoute(pathname) });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Перешли на другую страницу — запомнить во вкладке (окна — настройки, профиль, вкладки — не в счёт)
  useEffect(() => {
    if (bound.current === active && !isWindowRoute(pathname)) updateTabPath(active, here);
  }, [here]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
