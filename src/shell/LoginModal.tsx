/**
 * Вход, регистрация и сброс пароля nhentai — перенос `components/SideMenu/LoginModal.tsx`.
 * Порядок как в старом: капча → задача PoW (`/pow?action=…`) → запрос → профиль.
 * Капча проходится в отдельном окне (`requestCaptcha`: Android — диалог, ПК — окно nhentai.net), после ошибки её нужно пройти заново.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { login, register, requestPasswordReset } from "../api/auth";
import { ApiError } from "../api/client";
import { getCaptchaInfo, getPowChallenge, solvePoW } from "../api/config";
import { useI18n } from "../i18n/I18nContext";
import { captchaSupported, refreshMe, requestCaptcha } from "../lib/session";
import { Icon, Spinner } from "../ui";
import { useBackHandler } from "./androidBack";

type AuthMode = "login" | "register" | "reset";

export function LoginModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [captcha, setCaptcha] = useState<{ site_key: string; provider: string } | null>(null);
  const [captchaLoaded, setCaptchaLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [powBusy, setPowBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  useBackHandler(visible, onClose);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    setResetSent(false);
    setToken(null);
    setCaptchaLoaded(false);
    getCaptchaInfo()
      .then((c) => !cancelled && setCaptcha(c.site_key ? c : null))
      .catch(() => !cancelled && setCaptcha(null))
      .finally(() => !cancelled && setCaptchaLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [visible, mode]);

  if (!visible) return null;

  const resetForm = () => {
    setUsername("");
    setEmail("");
    setPassword("");
    setPassword2("");
    setToken(null);
    setError(null);
  };

  const switchMode = (m: AuthMode) => {
    setMode(m);
    resetForm();
    setResetSent(false);
  };

  const passCaptcha = async () => {
    if (!captcha) return;
    const tok = await requestCaptcha(captcha.site_key, captcha.provider, {
      title: t("commentComposer.captcha.title"),
      error: t("login.form.captchaFailed"),
      retry: t("common.retry"),
      cancel: t("common.cancel"),
    });
    setToken(tok || null);
  };

  const run = async () => {
    setError(null);
    if (!captcha?.site_key) return setError(t("login.form.captchaUnavailable"));
    if (!token) return setError(t("login.form.captchaRequired"));

    const u = username.trim();
    const em = email.trim();
    if (mode === "login" && (!u || !password)) return setError(t("login.form.fillAll"));
    if (mode === "register" && (!u || !em || !password)) return setError(t("login.form.fillAll"));
    if (mode === "register" && password !== password2) return setError(t("login.form.passwordMismatch"));
    if (mode === "reset" && !em) return setError(t("login.form.emailRequired"));

    setBusy(true);
    setPowBusy(true);
    try {
      const pow = await getPowChallenge(mode);
      const nonce = await solvePoW(pow.challenge, pow.difficulty);
      setPowBusy(false);
      const guard = { pow_challenge: pow.challenge, pow_nonce: nonce, captcha_response: token };
      if (mode === "reset") {
        await requestPasswordReset({ email: em, ...guard });
        setResetSent(true);
        resetForm();
        return;
      }
      if (mode === "login") await login({ username: u, password, ...guard });
      else await register({ username: u, email: em, password, ...guard });
      await refreshMe();
      resetForm();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? String(e.message) : t("login.form.failed"));
      setToken(null);
    } finally {
      setBusy(false);
      setPowBusy(false);
    }
  };

  const title =
    mode === "login" ? t("menu.login") : mode === "register" ? t("login.form.registerTitle") : t("login.form.resetTitle");

  return createPortal(
    <div className="login-backdrop" onClick={onClose}>
      <div className="login-card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="login-header">
          <span className="login-title">{title}</span>
          <button type="button" className="login-close" aria-label={t("common.close")} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="login-tabs">
          {(["login", "register", "reset"] as AuthMode[]).map((m) => (
            <button key={m} type="button" className={mode === m ? "is-active" : ""} onClick={() => switchMode(m)}>
              {m === "login" ? t("menu.login") : m === "register" ? t("login.form.registerTab") : t("login.form.resetTab")}
            </button>
          ))}
        </div>

        <form
          className="login-body"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {resetSent && <p className="login-hint">{t("login.form.resetSent")}</p>}

          {mode !== "reset" && (
            <label className="login-field">
              <span>{mode === "login" ? t("login.form.identifier") : t("login.form.username")}</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                disabled={busy}
                placeholder={mode === "login" ? t("login.form.identifierPh") : t("login.form.usernamePh")}
              />
            </label>
          )}
          {mode !== "login" && (
            <label className="login-field">
              <span>{t("login.form.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoCapitalize="none"
                autoComplete="email"
                disabled={busy}
                placeholder="email@…"
              />
            </label>
          )}
          {mode !== "reset" && (
            <label className="login-field">
              <span>{t("login.form.password")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={busy}
                placeholder="••••••••"
              />
            </label>
          )}
          {mode === "register" && (
            <label className="login-field">
              <span>{t("login.form.passwordAgain")}</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                placeholder="••••••••"
              />
            </label>
          )}

          <div className="login-field">
            <span>{t("login.form.captcha")}</span>
            {!captchaLoaded ? (
              <p className="login-hint">{t("login.form.captchaLoadHint")}</p>
            ) : !captcha ? (
              <p className="login-hint">{t("login.form.captchaUnavailable")}</p>
            ) : !captchaSupported() ? (
              <p className="login-hint">{t("login.form.captchaAndroidOnly")}</p>
            ) : (
              <button
                type="button"
                className={token ? "login-captcha is-done" : "login-captcha"}
                disabled={busy}
                onClick={() => void passCaptcha()}
              >
                <Icon name={token ? "check-circle" : "shield"} size={18} />
                {token ? t("login.form.captchaDone") : t("login.form.captchaStart")}
              </button>
            )}
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={busy || powBusy}>
            {busy || powBusy ? (
              <>
                <Spinner size={16} />
                {powBusy ? t("login.form.powWait") : t("login.form.loginInProgress")}
              </>
            ) : mode === "reset" ? (
              t("login.form.submitReset")
            ) : mode === "register" ? (
              t("login.form.submitRegister")
            ) : (
              t("login.form.submitLogin")
            )}
          </button>
          <p className="login-footer">nhentai.net · API v2</p>
        </form>
      </div>
    </div>,
    document.body,
  );
}
