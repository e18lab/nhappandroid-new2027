/**
 * Аккаунт nhentai у вкладки выбирается один раз — при открытии новой вкладки (у «+» на ПК после выбора ресурса,
 * на телефоне на экране вкладок). В открытой вкладке аккаунт не меняется: нужен другой — новая вкладка.
 * Здесь: аватар аккаунта, список выбора аккаунта для новой вкладки и «добавить аккаунт» (новая вкладка без входа
 * и окно входа — вошли, и вкладка запомнила аккаунт).
 */
import { DEFAULT_RESOURCE } from "../browser/resources";
import { openTab } from "../browser/tabs";
import { avatarUrl } from "../components/CommentCard";
import { useI18n } from "../i18n/I18nContext";
import { accountAuth, useNhAccounts, useSessionsVersion, type AccountAuth } from "../lib/nhAccounts";
import { useNhLink } from "../lib/mlNhentai";
import { useMe } from "../lib/session";
import { Icon } from "../ui";
import { openLogin } from "./LoginModal";

/** Аватар аккаунта nhentai или буква. */
export function NhAvatar({ src, name, size = 24, className = "" }: { src?: string | null; name?: string; size?: number; className?: string }) {
  const url = src ? avatarUrl(src) : "";
  return (
    <span className={`nh-ava ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name ? name.charAt(0).toUpperCase() : <Icon name="user" size={Math.round(size * 0.6)} />}
    </span>
  );
}

/** Состояние входа аккаунта для списков: значок и подпись (проблемы — заметно, всё хорошо — тихо). */
export function useAccountAuth(): (id: number) => AccountAuth {
  useSessionsVersion();
  const link = useNhLink();
  return (id) => accountAuth(id, link.accounts?.find((a) => a.id === id) ?? null);
}

export function AuthStatus({ auth }: { auth: AccountAuth }) {
  const { t } = useI18n();
  if (auth === "unknown") return null;
  const icon = auth === "key" ? "key" : auth === "expired" ? "alert-circle" : "alert-triangle";
  return (
    <span className={`auth-st is-${auth}`}>
      <Icon name={icon} size={11} />
      {t(`nhkey.st.${auth}`)}
    </span>
  );
}

/** Новая вкладка ресурса с аккаунтом (null — без входа). */
export function openTabWithAccount(account: number | null, resource: string = DEFAULT_RESOURCE): void {
  openTab(resource, "/", undefined, account);
}

/** Добавить аккаунт: новая вкладка без входа и окно входа. */
export function addNhAccountInNewTab(resource: string = DEFAULT_RESOURCE): void {
  openTab(resource, "/", undefined, null);
  openLogin();
}

/**
 * Выбор аккаунта для новой вкладки: аккаунты (вошедшие на устройстве и привязанные к MoeLibre), «Без входа»,
 * «Добавить аккаунт». Аккаунт открытой сейчас вкладки — первым и отмечен.
 */
export function NewTabAccountList({ onPick }: { onPick: (account: number | null | "add") => void }) {
  const { t } = useI18n();
  const me = useMe();
  const accounts = [...useNhAccounts()].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
  const authOf = useAccountAuth();
  return (
    <div className="nt-accs" role="menu">
      {accounts.map((a) => (
        <button key={a.id} type="button" role="menuitem" className={a.id === me?.id ? "nt-acc is-current" : "nt-acc"} onClick={() => onPick(a.id)}>
          <span className="nt-acc-ava">
            <NhAvatar src={a.avatar} name={a.username} size={30} />
            {(authOf(a.id) === "expired" || authOf(a.id) === "keyOnly") && <i className={`nt-acc-flag is-${authOf(a.id)}`} aria-hidden />}
          </span>
          <span className="nt-acc-text">
            <b>{a.username}</b>
            <span>
              {authOf(a.id) === "expired" ? (
                <AuthStatus auth="expired" />
              ) : (
                <>
                  {a.id === me?.id ? t("tabs.currentAccount") : a.linked ? t("accounts.linkedMl") : t("accounts.localOnly")}
                  {authOf(a.id) !== "key" && authOf(a.id) !== "unknown" && (
                    <>
                      {" · "}
                      <AuthStatus auth={authOf(a.id)} />
                    </>
                  )}
                </>
              )}
            </span>
          </span>
        </button>
      ))}
      <button type="button" role="menuitem" className="nt-acc" onClick={() => onPick(null)}>
        <NhAvatar size={30} />
        <span className="nt-acc-text">
          <b>{t("accounts.guest")}</b>
          <span>{t("accounts.guestSub")}</span>
        </span>
      </button>
      <button type="button" role="menuitem" className="nt-acc is-action" onClick={() => onPick("add")}>
        <span className="nt-acc-icon">
          <Icon name="plus" size={18} />
        </span>
        <span className="nt-acc-text">
          <b>{t("accounts.add")}</b>
          <span>{t("tabs.addSub")}</span>
        </span>
      </button>
    </div>
  );
}
