/**
 * Состояние входа аккаунта вкладки — прямо на страницах (а не всплывашкой):
 *  - сессия устарела и ключа API нет (входа нет вовсе) — вместо страницы экран «Сессия устарела, войдите»:
 *    «Войти» или «Продолжить без входа» (до перезапуска для этого аккаунта);
 *  - сессия устарела, но ключ есть — аккаунт работает; сверху страницы карточка «войдите, чтобы писать
 *    комментарии и менять профиль»;
 *  - сессия жива, а ключа нет — карточка «добавьте ключ API для стабильной работы» (капча один раз).
 * Окна (настройки, аккаунты, MoeLibre…) не закрываются — через них и входят. Карточки можно скрыть.
 * Карточка стоит в начале ленты (`AccountNoticeSlot` внутри прокрутки), а не над экраном: листается вместе
 * со страницей и не прячется под шапкой на телефоне.
 */
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { ACCESS_TOKEN_KEY, ACCOUNT_KEY_KEY, hasSession, hasUserSession } from "../api/client";
import { useActiveTabId, useTabs } from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { hasAccountKey, isSwitchingNhAccount, savedAuthKind, useNhAccounts, useSessionsVersion } from "../lib/nhAccounts";
import { ensureAccountKey } from "../lib/nhKey";
import { mlSignedIn, useMl } from "../lib/mlid";
import { captchaSupported, useMe } from "../lib/session";
import { getItem, setItem, subscribeKey } from "../lib/storage";
import { Icon, Spinner, useToast } from "../ui";
import { openLogin } from "./LoginModal";
import { setActiveTabAccount } from "../browser/tabBinding";
import { isWindowRoute } from "./windowRoutes";

type AccState = "ok" | "pending" | "expired" | "keyOnly" | "noKey";

/** Карточку «сессия устарела, работает по ключу» скрыли — до перезапуска, по вкладке. */
const guestOk = new Set<string>();
/** «Позже» у карточки ключа — на неделю. */
const KEY_LATER = "@local.nhkey.later";
const LATER_MS = 7 * 24 * 3600 * 1000;

function useAuthTick(): string {
  const a = useSyncExternalStore((cb) => subscribeKey(ACCESS_TOKEN_KEY, cb), () => getItem(ACCESS_TOKEN_KEY) ?? "");
  const k = useSyncExternalStore((cb) => subscribeKey(ACCOUNT_KEY_KEY, cb), () => getItem(ACCOUNT_KEY_KEY) ?? "");
  return `${a.length}|${k.length}`;
}

/** Аккаунт выбранной вкладки и что с его входом. */
function useTabAccount(): { tabId: string; account: number | null; name: string; state: AccState } {
  useAuthTick();
  useSessionsVersion(); // конец переключения аккаунта и «сессия устарела» — перерисовать
  const tabs = useTabs();
  const active = useActiveTabId();
  const me = useMe();
  const accounts = useNhAccounts();
  const account = tabs.find((x) => x.id === active)?.account ?? null;
  const tabId = active ?? "";
  const name = accounts.find((a) => a.id === account)?.username ?? (account ? `#${account}` : "");
  if (account == null) return { tabId, account, name, state: "ok" };
  // Клиент ещё переключается на аккаунт вкладки — решаем по сохранённому на устройстве, а не показываем
  // страницу (иначе у невошедшего аккаунта на секунду мелькали тайтлы, а потом экран входа)
  if (isSwitchingNhAccount() || me?.id !== account) {
    const saved = savedAuthKind(account);
    if (saved === "expired") return { tabId, account, name, state: "expired" };
    if (saved === "none" && (isSwitchingNhAccount() || hasSession())) return { tabId, account, name, state: "pending" };
    if (saved === "usable" || me) return { tabId, account, name, state: "ok" };
  }
  if (!hasSession()) return { tabId, account, name, state: "expired" };
  if (!hasUserSession()) return { tabId, account, name, state: "keyOnly" };
  if (!hasAccountKey(account)) return { tabId, account, name, state: "noKey" };
  return { tabId, account, name, state: "ok" };
}

/**
 * Содержимое экрана с учётом входа: экран «сессия устарела» вместо страницы или карточка сверху.
 * `root` — главный раздел (карточки показываются только там, чтобы не мелькать на каждой странице).
 */
export function AccountGate({ pathname, root, children }: { pathname: string; root: boolean; children: ReactNode }) {
  const { tabId, account, name, state } = useTabAccount();
  const [, bump] = useState(0);
  if (isWindowRoute(pathname) || state === "ok" || account == null) return <div className="content">{children}</div>;
  // Вход берут из привязки — пока не ясно, есть ли он, вместо страницы загрузка
  if (state === "pending") {
    return (
      <div className="content">
        <div className="acc-gate">
          <Spinner size={28} />
        </div>
      </div>
    );
  }
  if (state === "expired") {
    return (
      <div className="content">
        <ExpiredPage
          name={name}
          // Вкладка становится гостевой («Без входа»): аккаунт у неё снимается, клиент — без входа
          onGuest={() => void setActiveTabAccount(null)}
        />
      </div>
    );
  }
  const card = root ? <NoticeCard state={state} name={name} account={account} tabId={tabId} onHide={() => bump((n) => n + 1)} /> : null;
  return (
    <div className="content">
      <NoticeContext.Provider value={card}>{children}</NoticeContext.Provider>
    </div>
  );
}

const NoticeContext = createContext<ReactNode>(null);

/** Место карточки входа в начале прокручиваемой ленты главного раздела. */
export function AccountNoticeSlot() {
  return <>{useContext(NoticeContext)}</>;
}

function ExpiredPage({ name, onGuest }: { name: string; onGuest: () => void }) {
  const { t } = useI18n();
  return (
    <div className="acc-gate">
      <span className="acc-gate-icon">
        <Icon name="lock" size={30} />
      </span>
      <h2>{t("nhkey.expiredTitle", { name })}</h2>
      <p>{t("nhkey.expiredPage")}</p>
      {/* Окно входа — с ником этого аккаунта */}
      <button type="button" className="acc-gate-primary" onClick={() => openLogin(name.startsWith("#") ? undefined : name)}>
        <Icon name="log-in" size={18} />
        {t("nhkey.signIn")}
      </button>
      <button type="button" className="acc-gate-secondary" onClick={onGuest}>
        {t("nhkey.continueGuest")}
      </button>
      <p className="acc-gate-hint">{t("nhkey.expiredHint")}</p>
    </div>
  );
}

function hiddenLater(account: number): boolean {
  try {
    const all = JSON.parse(getItem(KEY_LATER) ?? "{}") as Record<string, number>;
    return Date.now() - (all[account] ?? 0) < LATER_MS;
  } catch {
    return false;
  }
}

function NoticeCard({ state, name, account, tabId, onHide }: { state: AccState; name: string; account: number; tabId: string; onHide: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useMl(); // перерисовка при входе / выходе из MoeLibre ID
  // Входа нет («Продолжить без входа») — ни карточки «сессия», ни ключа: ключ без входа не создать
  if (state === "ok" || state === "pending" || state === "expired") return null;
  if (state === "keyOnly" && guestOk.has(tabId)) return null;
  // Ключ хранится в MoeLibre ID и создаётся через капчу: без входа в MoeLibre (или там, где капчи нет —
  // браузер при разработке) не предлагаем
  if (state === "noKey" && (hiddenLater(account) || !mlSignedIn() || !captchaSupported())) return null;

  if (state === "keyOnly") {
    return (
      <div className="acc-notice is-warn">
        <span className="acc-notice-icon">
          <Icon name="alert-triangle" size={18} />
        </span>
        <span className="acc-notice-text">
          <b>{t("nhkey.expiredTitle", { name })}</b>
          <span>{t("nhkey.expiredKeySub")}</span>
        </span>
        <button type="button" className="acc-notice-btn" onClick={() => openLogin()}>
          {t("nhkey.signIn")}
        </button>
        <button
          type="button"
          className="acc-notice-x"
          aria-label={t("common.close")}
          onClick={() => {
            guestOk.add(tabId);
            onHide();
          }}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    );
  }

  const add = async () => {
    setBusy(true);
    const r = await ensureAccountKey({ title: t("nhkey.captchaTitle"), error: t("login.form.captchaFailed"), retry: t("common.retry"), cancel: t("common.cancel") });
    setBusy(false);
    if (r === "ok" || r === "exists") toast.showToast({ title: t("nhkey.keyCreated"), type: "success" });
    else if (r === "failed") toast.showToast({ title: t("nhkey.keyFailed"), type: "error" });
    onHide();
  };

  return (
    <div className="acc-notice">
      <span className="acc-notice-icon">
        <Icon name="key" size={18} />
      </span>
      <span className="acc-notice-text">
        <b>{t("nhkey.addTitle", { name })}</b>
        <span>{t("nhkey.addSub")}</span>
      </span>
      <button type="button" className="acc-notice-btn" disabled={busy} onClick={() => void add()}>
        {busy ? <Spinner size={14} /> : t("nhkey.add")}
      </button>
      <button
        type="button"
        className="acc-notice-x"
        aria-label={t("nhkey.later")}
        title={t("nhkey.later")}
        onClick={() => {
          try {
            const all = JSON.parse(getItem(KEY_LATER) ?? "{}") as Record<string, number>;
            all[account] = Date.now();
            setItem(KEY_LATER, JSON.stringify(all));
          } catch {
            /* не запомнили — покажется снова */
          }
          onHide();
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
