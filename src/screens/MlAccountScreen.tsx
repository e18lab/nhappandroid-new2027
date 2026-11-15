/**
 * Аккаунт MoeLibre ID (`/mlid`, на ПК — окном поверх экрана): шапка с аватаром (свой загружается нажатием),
 * именем и способами входа; ресурсы с привязанными аккаунтами (у nhentai их может быть несколько, активный —
 * тот, в который вошли на устройстве); устройства и выход. Без входа — приглашение войти.
 * Опасные действия (отвязать, отключить устройство, выйти) — в два нажатия: первое меняет кнопку на «подтвердить».
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import mlIdLogo from "../assets/brand/ml-id.svg";
import { avatarUrl } from "../components/CommentCard";
import { RESOURCES, resourceById } from "../browser/resources";
import { useI18n } from "../i18n/I18nContext";
import {
  cancelMlLogin,
  clearMlLoginNotice,
  isCustomMlAvatar,
  listMlSessions,
  MlError,
  mlSignOut,
  refreshMlProfile,
  resetMlAvatar,
  revokeMlSession,
  startMlLogin,
  unlinkMlIdentity,
  updateMlProfile,
  uploadMlAvatar,
  useMl,
  type MlDeviceSession,
  type MlProvider,
} from "../lib/mlid";
import { linkNh, refreshNhLinks, unlinkNh, useNhLink } from "../lib/mlNhentai";
import { addNhAccountInNewTab } from "../shell/TabAccount";
import { useMe } from "../lib/session";
import { timeAgo } from "../lib/timeAgo";
import { openLogin } from "../shell/LoginModal";
import { openMlLogin } from "../shell/MlLoginModal";
import { Icon, Spinner, useToast } from "../ui";
import { ProviderMark } from "../ui/ProviderMark";
import { MlCloudCard } from "./MlCloud";

const PROVIDER_COLOR: Record<string, string> = { google: "#4285F4", telegram: "#2AABEE" };
const PROVIDERS: MlProvider[] = ["google", "telegram"];

export function MlAccountScreen() {
  const { t, resolved } = useI18n();
  const { account, profile, login } = useMl();
  const navigate = useNavigate();
  const toast = useToast();
  const [sessions, setSessions] = useState<{ current: string; sessions: MlDeviceSession[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [arming, setArming] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nh = useNhLink();
  const nhMe = useMe();

  useEffect(() => {
    if (!account) return;
    void refreshMlProfile();
    void refreshNhLinks();
    listMlSessions().then(setSessions, (e) => setError(String(e?.message ?? e)));
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setName(account?.display_name ?? ""), [account?.display_name]);

  // Привязка способа входа закончилась (успех или ошибка) — сказать и сбросить
  useEffect(() => {
    if (login.phase === "idle" && login.linked) {
      toast.showToast({ title: t("mlid.login.linked", { provider: t(`mlid.provider.${login.linked}`) }) });
      clearMlLoginNotice();
    } else if (login.phase === "error" && login.link) {
      const key = `mlid.err.${login.code}`;
      const text = t(key);
      toast.showToast({ title: text === key ? t("mlid.err.generic", { code: login.code }) : text, type: "error" });
      clearMlLoginNotice();
    }
  }, [login]); // eslint-disable-line react-hooks/exhaustive-deps

  // Второе нажатие «подтвердить» — в течение 4 секунд
  useEffect(() => {
    if (!arming) return;
    const timer = window.setTimeout(() => setArming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [arming]);

  if (!account) {
    return (
      <div className="screen-scroll ml-acc">
        <div className="ml-acc-guest">
          <img src={mlIdLogo} alt="MoeLibre ID" className="ml-acc-guest-logo" />
          <p>{t("mlid.subtitle")}</p>
          <button type="button" className="ml-btn is-primary is-big" onClick={openMlLogin}>
            {t("mlid.signIn")}
          </button>
        </div>
      </div>
    );
  }

  const errText = (e: unknown) => {
    const code = e instanceof MlError ? e.code : String((e as Error)?.message ?? e);
    const key = `mlid.err.${code}`;
    const text = t(key);
    return text === key ? t("mlid.err.generic", { code }) : text;
  };
  const fail = (e: unknown) => toast.showToast({ title: errText(e), type: "error" });

  const saveName = async () => {
    const v = name.trim();
    if (!v || v === account.display_name) return;
    try {
      await updateMlProfile({ display_name: v });
      toast.showToast({ title: t("mlid.nameSaved") });
    } catch (e) {
      fail(e);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      await uploadMlAvatar(file);
      toast.showToast({ title: t("mlid.avatar.saved") });
    } catch (e) {
      fail(e);
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const dropAvatar = async () => {
    setAvatarBusy(true);
    try {
      await resetMlAvatar();
    } catch (e) {
      fail(e);
    } finally {
      setAvatarBusy(false);
    }
  };

  const revoke = async (s: MlDeviceSession) => {
    if (arming !== s.id) return setArming(s.id);
    setArming(null);
    try {
      await revokeMlSession(s.id);
      setSessions((cur) => cur && { ...cur, sessions: cur.sessions.filter((x) => x.id !== s.id) });
      toast.showToast({ title: t("mlid.revoked") });
    } catch (e) {
      fail(e);
    }
  };

  const doLink = async () => {
    try {
      await linkNh();
      toast.showToast({ title: t("mlid.nh.linkedToast") });
    } catch (e) {
      fail(e);
    }
  };

  const doUnlink = async (id: number) => {
    const key = `unlink-${id}`;
    if (arming !== key) return setArming(key);
    setArming(null);
    try {
      await unlinkNh(id);
      toast.showToast({ title: t("mlid.nh.unlinkedToast") });
    } catch (e) {
      fail(e);
    }
  };

  const doAdd = async () => {
    try {
      addNhAccountInNewTab();
    } catch (e) {
      fail(e);
    }
  };

  const removeIdentity = async (provider: MlProvider) => {
    const key = `idrm-${provider}`;
    if (arming !== key) return setArming(key);
    setArming(null);
    try {
      await unlinkMlIdentity(provider);
      toast.showToast({ title: t("mlid.login.removed", { provider: t(`mlid.provider.${provider}`) }) });
    } catch (e) {
      fail(e);
    }
  };

  const addIdentity = (provider: MlProvider) => {
    if (login.phase === "waiting" && login.link && login.provider === provider) cancelMlLogin();
    else void startMlLogin(provider, { link: true });
  };

  const signOut = () => {
    if (arming !== "signout") return setArming("signout");
    void mlSignOut();
  };

  const initial = (account.display_name || "M").trim().charAt(0).toUpperCase();
  const identities = profile?.identities ?? [];
  const custom = isCustomMlAvatar(account.avatar_url);
  const nhRes = resourceById("nhentai");
  const nhAccounts = nh.accounts ?? [];
  const idAvatar = (id: number) => profile?.links.find((l) => l.service === "nhentai" && l.external_id === String(id))?.avatar_url ?? null;
  // Вошли здесь в аккаунт, которого нет среди привязанных
  const unlinkedHere = nhMe && nh.accounts && !nhAccounts.some((a) => a.id === nhMe.id) ? nhMe : null;
  const linkedCount = nhAccounts.length ? 1 : 0;

  return (
    <div className="screen-scroll ml-acc">
      <section className="ml-hero">
        <img src={mlIdLogo} alt="" className="ml-hero-mark" aria-hidden />
        <div className="ml-hero-avatar-wrap">
          <button
            type="button"
            className="ml-hero-avatar"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            title={t("mlid.avatar.change")}
            aria-label={t("mlid.avatar.change")}
          >
            {account.avatar_url ? <img src={account.avatar_url} alt="" referrerPolicy="no-referrer" /> : initial}
            <span className="ml-hero-avatar-over">{avatarBusy ? <Spinner size={22} /> : <Icon name="camera" size={24} />}</span>
          </button>
          {custom && !avatarBusy && (
            <button type="button" className="ml-hero-avatar-reset" onClick={() => void dropAvatar()} title={t("mlid.avatar.reset")} aria-label={t("mlid.avatar.reset")}>
              <Icon name="x" size={14} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pickAvatar(e.target.files?.[0])} />
        </div>
        <div className="ml-hero-body">
          {editing ? (
            <input
              className="ml-hero-input"
              autoFocus
              value={name}
              maxLength={40}
              placeholder={t("mlid.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setEditing(false);
                void saveName();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setName(account.display_name);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button type="button" className="ml-hero-name" onClick={() => setEditing(true)} title={t("mlid.nameLabel")}>
              <b>{account.display_name || "MoeLibre"}</b>
              <Icon name="edit-2" size={16} />
            </button>
          )}
          <span className="ml-hero-since">{t("mlid.since", { date: new Date(account.created_at).toLocaleDateString(resolved) })}</span>
          <div className="ml-hero-chips">
            {identities.map((i) => {
              const armed = arming === `idrm-${i.provider}`;
              return (
                <span key={i.provider} className={armed ? "ml-chip is-armed" : "ml-chip"} style={{ "--c": PROVIDER_COLOR[i.provider] ?? "#888" } as CSSProperties} title={i.email || i.display_name || undefined}>
                  <ProviderMark provider={i.provider} size={16} />
                  {t(`mlid.provider.${i.provider}`)}
                  {(i.email || i.display_name) && <em>{i.email || i.display_name}</em>}
                  {identities.length > 1 && (
                    <button
                      type="button"
                      className="ml-chip-x"
                      onClick={() => void removeIdentity(i.provider)}
                      title={t("mlid.login.remove")}
                      aria-label={t("mlid.login.remove")}
                    >
                      {armed ? t("mlid.login.removeConfirm") : <Icon name="x" size={12} />}
                    </button>
                  )}
                </span>
              );
            })}
            {profile &&
              PROVIDERS.filter((p) => !identities.some((i) => i.provider === p)).map((p) => {
                const waiting = (login.phase === "waiting" && login.link && login.provider === p) || (login.phase === "exchanging" && login.link);
                return (
                  <button key={p} type="button" className={waiting ? "ml-chip is-add is-waiting" : "ml-chip is-add"} style={{ "--c": PROVIDER_COLOR[p] } as CSSProperties} onClick={() => addIdentity(p)}>
                    {waiting ? <Spinner size={12} /> : <ProviderMark provider={p} size={16} />}
                    {waiting ? t("mlid.login.waiting") : t("mlid.login.add", { provider: t(`mlid.provider.${p}`) })}
                  </button>
                );
              })}
            {!profile && <Spinner size={16} />}
          </div>
        </div>
      </section>

      <div className="ml-sec-head">
        <h3>{t("mlcloud.title")}</h3>
      </div>
      <MlCloudCard />

      <div className="ml-sec-head">
        <h3>{t("mlid.linked")}</h3>
        <span>{t("mlid.linkedCount", { n: linkedCount, total: RESOURCES.length })}</span>
      </div>

      <div className={nhAccounts.length ? "ml-resbox is-linked" : "ml-resbox"} style={{ "--c": nhRes.color } as CSSProperties}>
        <div className="ml-resbox-head">
          <span className="ml-res-mark">
            {nhRes.mark}
            {nhAccounts.length > 0 && (
              <i className="ml-res-tick" aria-hidden>
                <Icon name="check" size={11} />
              </i>
            )}
          </span>
          <span className="ml-res-text">
            <b>{nhRes.name}</b>
            <span>{nhAccounts.length ? t("mlid.nh.count", { n: nhAccounts.length }) : t("mlid.notLinked")}</span>
          </span>
          {nh.accounts === null && <Spinner size={18} />}
          {nh.accounts !== null && !nhMe && !nhAccounts.length && (
            <button type="button" className="ml-btn is-primary" onClick={openLogin}>
              {t("mlid.nh.signIn")}
            </button>
          )}
        </div>

        {(nhAccounts.length > 0 || unlinkedHere) && (
          <div className="ml-accs">
            {nhAccounts.map((a) => {
              const here = nhMe?.id === a.id;
              const avatar = here ? avatarUrl(nhMe?.avatar_url) : idAvatar(a.id);
              const busy = nh.busy === a.id;
              return (
                <div key={a.id} className={here ? "ml-acc-item is-here" : "ml-acc-item"}>
                  <span className="ml-acc-ava">{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : (a.username || "?").charAt(0).toUpperCase()}</span>
                  <span className="ml-acc-text">
                    <b>{a.username}</b>
                    <span>{here ? t("accounts.inTab") : a.updated_at ? t("mlid.nh.usedAgo", { time: timeAgo(a.updated_at, resolved) }) : `#${a.id}`}</span>
                  </span>
                  {busy ? (
                    <Spinner size={18} />
                  ) : (
                    <>
                      <button type="button" className="ml-btn is-soft" onClick={() => navigate("/accounts/nhentai")}>
                        {t("accounts.manage")}
                      </button>
                      <button
                        type="button"
                        className={arming === `unlink-${a.id}` ? "ml-btn is-danger" : "ml-btn is-icon"}
                        onClick={() => void doUnlink(a.id)}
                        title={t("mlid.nh.unlink")}
                        aria-label={t("mlid.nh.unlink")}
                      >
                        {arming === `unlink-${a.id}` ? t("mlid.nh.unlinkConfirm") : <Icon name="trash-2" size={16} />}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {unlinkedHere && (
              <div className="ml-acc-item is-here is-pending">
                <span className="ml-acc-ava">
                  {unlinkedHere.avatar_url ? <img src={avatarUrl(unlinkedHere.avatar_url)} alt="" referrerPolicy="no-referrer" /> : unlinkedHere.username.charAt(0).toUpperCase()}
                </span>
                <span className="ml-acc-text">
                  <b>{unlinkedHere.username}</b>
                  <span>{t("mlid.nh.notLinkedHere")}</span>
                </span>
                {nh.busy !== null ? (
                  <Spinner size={18} />
                ) : (
                  <button type="button" className="ml-btn is-primary" onClick={() => void doLink()}>
                    {t("mlid.nh.link")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {(nhAccounts.length > 0 || unlinkedHere) && (
          <button type="button" className="ml-add" onClick={() => void doAdd()}>
            <Icon name="plus" size={16} />
            {t("mlid.nh.add")}
          </button>
        )}
      </div>

      <div className="ml-res-grid">
        {RESOURCES.filter((r) => !r.available).map((res) => (
          <div key={res.id} className="ml-res is-soon" style={{ "--c": res.color } as CSSProperties}>
            <span className="ml-res-mark">{res.mark}</span>
            <span className="ml-res-text">
              <b>{res.name}</b>
              <span>{t("mlid.res.soon")}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="ml-note">{t("mlid.linkedHint")}</p>

      <div className="ml-sec-head">
        <h3>{t("mlid.devices")}</h3>
        {sessions && <span>{sessions.sessions.length}</span>}
      </div>
      <div className="ml-panel">
        {error && <div className="ml-acc-error">{t("mlid.loadFailed", { error })}</div>}
        {!sessions && !error && (
          <div className="ml-acc-loading">
            <Spinner size={20} />
          </div>
        )}
        {sessions?.sessions.map((s) => {
          const current = s.id === sessions.current;
          return (
            <div key={s.id} className={current ? "ml-dev is-current" : "ml-dev"}>
              <span className="ml-dev-icon">
                <Icon name={/android|phone/i.test(s.device_name ?? "") ? "smartphone" : "layout"} size={20} />
              </span>
              <span className="ml-dev-text">
                <b>{s.device_name || s.device_id}</b>
                <span>{current ? t("mlid.thisDevice") : t("mlid.lastSeen", { time: timeAgo(s.last_used_at, resolved) })}</span>
              </span>
              {!current && (
                <button type="button" className={arming === s.id ? "ml-btn is-danger" : "ml-btn is-ghost"} onClick={() => void revoke(s)}>
                  {arming === s.id ? t("mlid.confirm") : t("mlid.revoke")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" className={arming === "signout" ? "ml-signout is-armed" : "ml-signout"} onClick={signOut}>
        <Icon name="log-out" size={18} />
        {arming === "signout" ? t("mlid.signOutConfirm") : t("mlid.signOut")}
      </button>
    </div>
  );
}
