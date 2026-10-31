/**
 * Вход, регистрация и сброс пароля nhentai — перенос `components/SideMenu/LoginModal.tsx`.
 * Порядок как в старом: капча → задача PoW (`/pow?action=…`) → запрос → профиль.
 * Капча проходится в отдельном окне (`requestCaptcha`: Android — диалог, ПК — окно nhentai.net), после ошибки её нужно пройти заново.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { login, register, requestPasswordReset } from "../api/auth";
import { ApiError } from "../api/client";
import { getCaptchaInfo, getPowChallenge, solvePoW } from "../api/config";
import { useI18n } from "../i18n/I18nContext";
import { captchaSupported, refreshMe, requestCaptcha } from "../lib/session";
import { Icon, Spinner } from "../ui";
import { useBackHandler } from "./androidBack";

type AuthMode = "login" | "register" | "reset";
const MODES: AuthMode[] = ["login", "register", "reset"];

let openListener: (() => void) | null = null;
/** Попросили открыть раньше, чем смонтировался `LoginHost` (эффекты экранов идут до эффектов Shell). */
let openPending = false;

/** Открыть окно входа откуда угодно (профиль гостя в панели, заголовке окна, шапке) — его держит `LoginHost` в Shell. */
export function openLogin() {
  if (openListener) openListener();
  else openPending = true;
}

/** Одно окно входа на всё приложение, открывается через `openLogin()`. */
export function LoginHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openListener = () => setOpen(true);
    if (openPending) {
      openPending = false;
      setOpen(true);
    }
    return () => {
      openListener = null;
    };
  }, []);
  return <LoginModal visible={open} onClose={() => setOpen(false)} />;
}

export function LoginModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [captcha, setCaptcha] = useState<{
    site_key: string;
    provider: string;
  } | null>(null);
  const [captchaLoaded, setCaptchaLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [powBusy, setPowBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  useBackHandler(visible, onClose);

  // Высота содержимого: обёртка тянется к ней с переходом, поэтому окно плавно растёт и сжимается при смене режима
  const innerRef = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!visible || !el) return;
    const ro = new ResizeObserver(() => setBodyH(el.offsetHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setBodyH(null);
    };
  }, [visible]);

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
    if (mode === "login" && (!u || !password))
      return setError(t("login.form.fillAll"));
    if (mode === "register" && (!u || !em || !password))
      return setError(t("login.form.fillAll"));
    if (mode === "register" && password !== password2)
      return setError(t("login.form.passwordMismatch"));
    if (mode === "reset" && !em) return setError(t("login.form.emailRequired"));

    setBusy(true);
    setPowBusy(true);
    try {
      const pow = await getPowChallenge(mode);
      const nonce = await solvePoW(pow.challenge, pow.difficulty);
      setPowBusy(false);
      const guard = {
        pow_challenge: pow.challenge,
        pow_nonce: nonce,
        captcha_response: token,
      };
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
      setError(
        e instanceof ApiError || e instanceof Error
          ? String(e.message)
          : t("login.form.failed"),
      );
      setToken(null);
    } finally {
      setBusy(false);
      setPowBusy(false);
    }
  };

  const title =
    mode === "login"
      ? t("menu.login")
      : mode === "register"
        ? t("login.form.registerTitle")
        : t("login.form.resetTitle");

  return createPortal(
    <div className="lg-backdrop" onClick={onClose}>
      <div
        className="lg-card"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lg-header">
          {/* На телефоне окно — страница на весь экран: «назад» слева вместо крестика (см. kit.css) */}
          <button
            type="button"
            className="lg-back"
            aria-label={t("common.back")}
            onClick={onClose}
          >
            <Icon name="arrow-left" size={24} />
          </button>
          <span key={mode} className="lg-title">
            {title}
          </span>
          <button
            type="button"
            className="lg-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <Icon name="x" size={22} />
          </button>
        </div>

        <div
          className="lg-seg"
          role="tablist"
          style={{ "--i": MODES.indexOf(mode) } as CSSProperties}
        >
          <span className="lg-seg-pill" />
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "is-active" : ""}
              onClick={() => switchMode(m)}
            >
              {m === "login"
                ? t("menu.login")
                : m === "register"
                  ? t("login.form.registerTab")
                  : t("login.form.resetTab")}
            </button>
          ))}
        </div>

        <div
          className="lg-body-wrap"
          style={bodyH === null ? undefined : { height: bodyH }}
        >
          <form
            className="lg-body"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div ref={innerRef} className="lg-inner">
              {resetSent && (
                <p className="lg-note">
                  <Icon name="check-circle" size={18} />
                  {t("login.form.resetSent")}
                </p>
              )}

              {/* Поля — одной карточкой-группой с разделителями, подпись поля — в плейсхолдере */}
              <div key={mode} className="lg-group">
                {mode !== "reset" && (
                  <label className="lg-field">
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      disabled={busy}
                      aria-label={
                        mode === "login"
                          ? t("login.form.identifier")
                          : t("login.form.username")
                      }
                      placeholder={
                        mode === "login"
                          ? t("login.form.identifier")
                          : t("login.form.username")
                      }
                    />
                  </label>
                )}
                {mode !== "login" && (
                  <label className="lg-field">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoCapitalize="none"
                      autoComplete="email"
                      disabled={busy}
                      aria-label={t("login.form.email")}
                      placeholder={t("login.form.email")}
                    />
                  </label>
                )}
                {mode !== "reset" && (
                  <label className="lg-field">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      disabled={busy}
                      aria-label={t("login.form.password")}
                      placeholder={t("login.form.password")}
                    />
                  </label>
                )}
                {mode === "register" && (
                  <label className="lg-field">
                    <input
                      type="password"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      autoComplete="new-password"
                      disabled={busy}
                      aria-label={t("login.form.passwordAgain")}
                      placeholder={t("login.form.passwordAgain")}
                    />
                  </label>
                )}
              </div>

              {/* Капча — строкой-кнопкой как в списках кита; пройдена — галочка цвета акцента */}
              {!captchaLoaded ? (
                <p className="lg-hint">{t("login.form.captchaLoadHint")}</p>
              ) : !captcha ? (
                <p className="lg-hint">{t("login.form.captchaUnavailable")}</p>
              ) : !captchaSupported() ? (
                <p className="lg-hint">{t("login.form.captchaAndroidOnly")}</p>
              ) : (
                <button
                  type="button"
                  className={token ? "lg-captcha is-done" : "lg-captcha"}
                  disabled={busy}
                  onClick={() => void passCaptcha()}
                >
                  <span className="lg-captcha-icon">
                    <Icon name={token ? "check" : "shield"} size={18} />
                  </span>
                  <span className="lg-captcha-text">
                    {token
                      ? t("login.form.captchaDone")
                      : t("login.form.captchaStart")}
                  </span>
                  {!token && <Icon name="chevron-right" size={18} />}
                </button>
              )}

              {error && (
                <div className="lg-error">
                  <Icon name="alert-circle" size={18} />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="ax-btn ax-btn-primary lg-submit"
                disabled={busy || powBusy}
              >
                {busy || powBusy ? (
                  <>
                    <Spinner size={18} />
                    {powBusy
                      ? t("login.form.powWait")
                      : t("login.form.loginInProgress")}
                  </>
                ) : mode === "reset" ? (
                  t("login.form.submitReset")
                ) : mode === "register" ? (
                  t("login.form.submitRegister")
                ) : (
                  t("login.form.submitLogin")
                )}
              </button>
              <p className="lg-footer">nhentai.net · API v2</p>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
