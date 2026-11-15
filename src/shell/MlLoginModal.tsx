/**
 * Окно входа в MoeLibre ID — главный аккаунт приложения. Вход через Google или Telegram в системном
 * браузере (`lib/mlid.ts`); пока браузер открыт, окно ждёт возврата и показывает «продолжите в браузере».
 * Вид — как у окна входа nhentai (стили `.lg-*`), сверху знак MoeLibre ID.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import mlIdLogo from "../assets/brand/ml-id.svg";
import { useI18n } from "../i18n/I18nContext";
import { cancelMlLogin, startMlLogin, useMl, type MlProvider } from "../lib/mlid";
import { Icon, Spinner } from "../ui";
import { ProviderMark } from "../ui/ProviderMark";
import { useBackHandler } from "./androidBack";

let openListener: (() => void) | null = null;
let openPending = false;

/** Открыть окно входа MoeLibre ID откуда угодно (вкладка профиля, настройки). */
export function openMlLogin() {
  if (openListener) openListener();
  else openPending = true;
}

/** Одно окно на всё приложение. */
export function MlLoginHost() {
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
  return <MlLoginModal visible={open} onClose={() => setOpen(false)} />;
}

export function MlLoginModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { account, login } = useMl();
  const [lastProvider, setLastProvider] = useState<MlProvider>("google");

  const close = () => {
    if (login.phase === "waiting") cancelMlLogin();
    onClose();
  };
  useBackHandler(visible, close);

  // Вошли — окно закрывается само
  useEffect(() => {
    if (visible && account && login.phase === "idle") onClose();
  }, [visible, account, login.phase, onClose]);

  if (!visible) return null;

  const start = (p: MlProvider) => {
    setLastProvider(p);
    void startMlLogin(p);
  };
  const errorText = (code: string) => {
    const key = `mlid.err.${code}`;
    const text = t(key);
    return text === key ? t("mlid.err.generic", { code }) : text;
  };

  return createPortal(
    <div className="lg-backdrop" onClick={close}>
      <div className="lg-card ml-login" role="dialog" aria-label={t("mlid.title")} onClick={(e) => e.stopPropagation()}>
        <div className="lg-header">
          <button type="button" className="lg-back" aria-label={t("common.back")} onClick={close}>
            <Icon name="arrow-left" size={24} />
          </button>
          <img className="ml-login-logo" src={mlIdLogo} alt="MoeLibre ID" />
          <button type="button" className="lg-close" aria-label={t("common.close")} onClick={close}>
            <Icon name="x" size={22} />
          </button>
        </div>

        <div className="ml-login-body">
          <h2 className="ml-login-title">{t("mlid.title")}</h2>
          <p className="ml-login-sub">{t("mlid.subtitle")}</p>

          {login.phase === "waiting" || login.phase === "exchanging" ? (
            <div className="ml-login-wait">
              <Spinner size={28} />
              <b>{login.phase === "waiting" ? t("mlid.waiting") : t("mlid.exchanging")}</b>
              {login.phase === "waiting" && <span>{t("mlid.waitingSub")}</span>}
              {login.phase === "waiting" && (
                <div className="ml-login-wait-actions">
                  <button type="button" className="ax-btn" onClick={() => start(login.provider)}>
                    {t("mlid.reopen")}
                  </button>
                  <button type="button" className="ax-btn" onClick={cancelMlLogin}>
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="ml-login-buttons">
              <button type="button" className="ml-login-btn is-google" onClick={() => start("google")}>
                <ProviderMark provider="google" />
                <span>{t("mlid.google")}</span>
              </button>
              <button type="button" className="ml-login-btn is-telegram" onClick={() => start("telegram")}>
                <ProviderMark provider="telegram" size={22} inverse />
                <span>{t("mlid.telegram")}</span>
              </button>
            </div>
          )}

          {login.phase === "error" && !login.link && (
            <div className="lg-error">
              <Icon name="alert-circle" size={18} />
              <span>{errorText(login.code)}</span>
              <button type="button" className="ml-login-retry" onClick={() => start(lastProvider)}>
                {t("common.retry")}
              </button>
            </div>
          )}

          <p className="lg-footer">{t("mlid.footer")}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
