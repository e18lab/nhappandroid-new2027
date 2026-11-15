/**
 * Аккаунты nhentai (`/accounts/nhentai`) — управление аккаунтами ресурса отдельно от настроек приложения:
 * все аккаунты (вошедшие на устройстве и привязанные к MoeLibre), какой открыт в этой вкладке, открыть в этой
 * вкладке, профиль и настройки аккаунта (для открытого), привязать к MoeLibre / отвязать, выйти на устройстве.
 * Опасное (отвязать, выйти) — в два нажатия.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { MlError, useMl } from "../lib/mlid";
import { linkNh, refreshNhLinks, unlinkNh, useNhLink } from "../lib/mlNhentai";
import { forgetSession, useNhAccounts } from "../lib/nhAccounts";
import { signOut, useMe } from "../lib/session";
import { openMlLogin } from "../shell/MlLoginModal";
import { addNhAccountInNewTab, NhAvatar, openTabWithAccount } from "../shell/TabAccount";
import { Icon, Spinner, useToast } from "../ui";

export function NhAccountsScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const { account: ml } = useMl();
  const link = useNhLink();
  const accounts = useNhAccounts();
  const [arming, setArming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (ml) void refreshNhLinks();
  }, [ml?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!arming) return;
    const timer = window.setTimeout(() => setArming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [arming]);

  const fail = (e: unknown) => {
    const code = e instanceof MlError ? e.code : String((e as Error)?.message ?? e);
    const key = `mlid.err.${code}`;
    const text = t(key);
    toast.showToast({ title: text === key ? t("mlid.err.generic", { code }) : text, type: "error" });
  };

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.showToast({ title: done });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const twoTap = (key: string, fn: () => void) => {
    if (arming !== key) return setArming(key);
    setArming(null);
    fn();
  };

  const open = (id: number) => openTabWithAccount(id);

  return (
    <div className="screen-scroll ml-acc">
      <p className="ml-page-lead">{t("accounts.lead")}</p>

      <div className="ml-resbox is-linked" style={{ "--c": "#ed2553" } as CSSProperties}>
        <div className="ml-resbox-head">
          <span className="ml-res-mark">nh</span>
          <span className="ml-res-text">
            <b>nhentai</b>
            <span>{t("mlid.nh.count", { n: accounts.length })}</span>
          </span>
          {link.busy !== null && <Spinner size={18} />}
        </div>

        <div className="ml-accs">
          {accounts.map((a) => {
            const here = me?.id === a.id;
            const k = String(a.id);
            return (
              <div key={a.id} className={here ? "ml-acc-item is-here" : "ml-acc-item"}>
                <NhAvatar src={a.avatar} name={a.username} size={36} />
                <span className="ml-acc-text">
                  <b>{a.username}</b>
                  <span>
                    {here ? t("accounts.inTab") : a.local ? t("accounts.onDevice") : t("accounts.inMlOnly")}
                    {" · "}
                    {a.linked ? t("accounts.linkedMl") : t("accounts.notLinked")}
                  </span>
                </span>
                {busy?.endsWith(`-${k}`) ? (
                  <Spinner size={18} />
                ) : (
                  <span className="acc-actions">
                    {here ? (
                      <button type="button" className="ml-btn is-soft" onClick={() => navigate("/accounts/nhentai/edit")}>
                        {t("accounts.profile")}
                      </button>
                    ) : (
                      <button type="button" className="ml-btn is-soft" onClick={() => open(a.id)}>
                        {t("accounts.openNewTab")}
                      </button>
                    )}
                    {ml && !a.linked && here && (
                      <button type="button" className="ml-btn is-ghost" onClick={() => void run(`link-${k}`, linkNh, t("mlid.nh.linkedToast"))}>
                        {t("mlid.nh.link")}
                      </button>
                    )}
                    {a.linked && (
                      <button
                        type="button"
                        className={arming === `unlink-${k}` ? "ml-btn is-danger" : "ml-btn is-ghost"}
                        onClick={() => twoTap(`unlink-${k}`, () => void run(`unlink-${k}`, () => unlinkNh(a.id), t("mlid.nh.unlinkedToast")))}
                      >
                        {arming === `unlink-${k}` ? t("mlid.nh.unlinkConfirm") : t("mlid.nh.unlink")}
                      </button>
                    )}
                    {a.local && (
                      <button
                        type="button"
                        className={arming === `out-${k}` ? "ml-btn is-danger" : "ml-btn is-icon"}
                        title={t("accounts.signOut")}
                        aria-label={t("accounts.signOut")}
                        onClick={() =>
                          twoTap(`out-${k}`, () =>
                            void run(`out-${k}`, async () => (here ? signOut() : forgetSession(a.id)), t("accounts.signedOut")),
                          )
                        }
                      >
                        {arming === `out-${k}` ? t("accounts.signOutConfirm") : <Icon name="log-out" size={16} />}
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
          {accounts.length === 0 && <div className="ml-empty">{t("accounts.none")}</div>}
        </div>

        <button type="button" className="ml-add" onClick={() => addNhAccountInNewTab()}>
          <Icon name="plus" size={16} />
          {t("mlid.nh.add")}
        </button>
      </div>

      <p className="ml-note">{ml ? t("accounts.hintMl") : t("accounts.hintNoMl")}</p>
      {!ml && (
        <button type="button" className="ml-btn is-primary is-big is-wide" onClick={openMlLogin}>
          {t("accounts.signInMl")}
        </button>
      )}
    </div>
  );
}
