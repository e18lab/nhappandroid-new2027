/**
 * Шапка главных разделов — новый кит (в духе Anixart): слева кнопка левого меню (`SideMenu`: аккаунт MoeLibre,
 * настройки, вкладки); справа выбор тегов и фильтры каталога (на главной). Поиск — в нижней панели. Шапка статичная: не уезжает при прокрутке и не участвует в переходах между
 * разделами. Настройки и профиль — в нижней панели. Внутренние экраны оставляют `TopBar` со стрелкой «назад».
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { Icon } from "../ui";
import { CatalogFilterButton } from "./CatalogFilter";
import { SideMenuButton } from "./SideMenu";
import { UpdateButton } from "./UpdateButton";

export function AppHeader({ title }: { title?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <header className="ax-header">
      {/* Меню: аккаунт MoeLibre, настройки, вкладки */}
      <SideMenuButton />
      {title && <h1 className="ax-header-title">{title}</h1>}
      <div className="ax-header-actions">
        {pathname === "/" && <UpdateButton />}
        {pathname === "/" && (
          <button type="button" className="ax-icon-btn" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
            <Icon name="tag" size={21} />
          </button>
        )}
        {pathname === "/" && <FilterButton />}
      </div>
    </header>
  );
}

/** Фильтры каталога (язык, страницы, дата, сортировка) — рядом с поиском. */
export function FilterButton({ className = "ax-icon-btn", size = 22 }: { className?: string; size?: number }) {
  const { t } = useI18n();
  return (
    <CatalogFilterButton
      trigger={({ onPress }) => (
        <button type="button" className={className} aria-label={t("explore.filter.sortTitle")} onClick={onPress}>
          <Icon name="sliders" size={size} className="ax-filter-icon" />
        </button>
      )}
    />
  );
}
