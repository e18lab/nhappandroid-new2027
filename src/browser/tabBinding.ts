/**
 * Вкладка ↔ клиент: аккаунт nhentai и фильтры каталога у каждой вкладки свои, а экраны читают их из общего
 * хранилища и текущей сессии. Поэтому при выборе вкладки её фильтры записываются в ключи фильтров, а её аккаунт
 * становится текущим (`activateNhAccount`); и наоборот — изменили фильтры или вошли в другой аккаунт, пока
 * вкладка выбрана, — это запоминается во вкладке. Скрытые вкладки ничего не загружают, так что этого хватает.
 * Работает на ПК и на телефоне (на телефоне вкладка выбирается на экране вкладок).
 */
import { activateNhAccount, isSwitchingNhAccount } from "../lib/nhAccounts";
import { nhLinkHooks } from "../lib/mlNhentai";
import { accountIntent, currentNhUserId, subscribeMe } from "../lib/session";
import { getItem, KEYS, removeItem, setItem, subscribeKey } from "../lib/storage";
import { HOME_TAB_KEY } from "../screens/homeTabs";
import { ACTIVE_TAB_KEY, getActiveTabId, getTabs, setBoundTabId, tabHooks, TABS_STORAGE_KEY, updateTabMeta, type BrowserTab } from "./tabs";

/** Фильтры каталога и открытый раздел главной — у каждой вкладки свои. */
export const TAB_FILTER_KEYS = [KEYS.tagFilter, KEYS.searchSort, KEYS.dateRange, KEYS.pagesFilter, HOME_TAB_KEY];

let applying = false;
/** Вкладка, чьи фильтры в ключах. */
let boundId: string | null = null;
/** Вкладка, чей аккаунт в клиенте (переключается асинхронно). */
let accountBoundId: string | null = null;

function currentFilters(): Record<string, string | null> {
  return Object.fromEntries(TAB_FILTER_KEYS.map((k) => [k, getItem(k)]));
}

/** Фильтры вкладки — в ключи. Синхронно и до того, как вкладка станет выбранной. */
function bindFilters(tab: BrowserTab) {
  boundId = tab.id;
  setBoundTabId(tab.id);
  // Фильтры: у вкладки ещё нет своих — она забирает текущие
  if (tab.filters) {
    applying = true;
    try {
      for (const k of TAB_FILTER_KEYS) {
        const v = tab.filters[k] ?? null;
        if (getItem(k) !== v) {
          if (v == null) removeItem(k);
          else setItem(k, v);
        }
      }
    } finally {
      applying = false;
    }
  } else updateTabMeta(tab.id, { filters: currentFilters() });
}

/** Аккаунт вкладки — текущим в клиенте. */
async function bindAccount(tab: BrowserTab) {
  accountBoundId = tab.id;
  // Аккаунт: у вкладки ещё нет своего — она забирает текущий
  if (tab.account === undefined) updateTabMeta(tab.id, { account: currentNhUserId() });
  else if (tab.account !== currentNhUserId()) {
    // Сессии этого аккаунта на устройстве нет — вкладку не переписываем (она общая с другими устройствами,
    // там этот аккаунт может быть). Клиент — без входа, а не под аккаунтом прошлой вкладки
    const ok = await activateNhAccount(tab.account);
    if (!ok && accountBoundId === tab.id) await activateNhAccount(null);
  }
}

function onActiveMaybeChanged() {
  const id = getActiveTabId();
  const tab = getTabs().find((t) => t.id === id);
  if (!tab) return;
  if (id !== boundId) bindFilters(tab);
  else if (tab.filters && TAB_FILTER_KEYS.some((k) => (tab.filters![k] ?? null) !== getItem(k))) {
    // Фильтры этой вкладки поменяли на другом устройстве — сразу в ключи (экраны вкладки обновятся)
    bindFilters(tab);
  }
  if (id !== accountBoundId) void bindAccount(tab);
  else if (tab.account !== undefined && tab.account !== currentNhUserId() && !isSwitchingNhAccount()) void bindAccount(tab);
}

let started = false;

export function initTabBinding(): void {
  if (started) return;
  started = true;

  // Фильтры новой вкладки — ещё до её выбора, чтобы ни одна вкладка не увидела чужих
  tabHooks.beforeActivate = (tab) => {
    if (tab.id !== boundId) bindFilters(tab);
  };
  subscribeKey(ACTIVE_TAB_KEY, onActiveMaybeChanged);
  // Список пришёл из облака или выбранную закрыли
  subscribeKey(TABS_STORAGE_KEY, onActiveMaybeChanged);

  for (const k of TAB_FILTER_KEYS) {
    subscribeKey(k, () => {
      if (applying || !boundId) return;
      const tab = getTabs().find((t) => t.id === boundId);
      if (tab) updateTabMeta(tab.id, { filters: { ...tab.filters, [k]: getItem(k) } });
    });
  }

  // Аккаунт вкладки меняется только намеренно: вошли в окне входа или вышли (`accountIntent`).
  // Раньше любая смена профиля переписывала вкладку — и сбой сессии, обновление токенов, запоздалый ответ
  // профиля или другое устройство без этого аккаунта (вкладки общие через облако) сбрасывали её аккаунт.
  accountIntent.onExplicit = (id) => {
    const tab = accountBoundId ? getTabs().find((t) => t.id === accountBoundId) : undefined;
    if (tab && tab.account !== id) updateTabMeta(tab.id, { account: id });
  };
  // Вкладка без аккаунта, и в ней вошли (в том числе не через окно входа) — запомнить
  subscribeMe(() => {
    if (!accountBoundId || isSwitchingNhAccount()) return;
    const id = currentNhUserId();
    const tab = getTabs().find((t) => t.id === accountBoundId);
    if (tab && tab.account == null && id != null) updateTabMeta(tab.id, { account: id });
  });

  // Вход «сам» после MoeLibre ID — только во вкладку, у которой ещё нет своего аккаунта
  nhLinkHooks.canAutoSignIn = () => {
    if (isSwitchingNhAccount()) return false;
    const tab = getTabs().find((t) => t.id === getActiveTabId());
    return !tab || tab.account === undefined;
  };

  onActiveMaybeChanged();
}

/** Аккаунт выбранной вкладки поменять (выбор в шапке): false — сессии этого аккаунта нет. */
export async function setActiveTabAccount(id: number | null): Promise<boolean> {
  const ok = await activateNhAccount(id);
  if (ok && accountBoundId) updateTabMeta(accountBoundId, { account: id });
  return ok;
}
