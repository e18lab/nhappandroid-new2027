/**
 * Шапка главных разделов — новый кит (в духе Anixart): логотип и заголовок слева, справа облако
 * (после входа) и поиск. Шапка статичная: не уезжает при прокрутке и не участвует в переходах между
 * разделами. Настройки и профиль — в нижней панели. Внутренние экраны оставляют `TopBar` со стрелкой «назад».
 */
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { Icon } from "../ui";
import { CloudButton } from "./CloudButton";

export function AppHeader({ title }: { title?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = useMe();

  return (
    <header className="ax-header">
      <button type="button" className="ax-header-logo" aria-label={t("nav.home")} onClick={() => navigate("/")}>
        <img src={logo} alt="" />
      </button>
      {title && <h1 className="ax-header-title">{title}</h1>}
      <div className="ax-header-actions">
        {me && <CloudButton />}
        <button type="button" className="ax-icon-btn" aria-label={t("nav.search")} onClick={() => navigate("/search")}>
          <Icon name="search" size={24} />
        </button>
      </div>
    </header>
  );
}
