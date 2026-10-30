/**
 * Нижняя панель — как FloatingTabBar в Anixart: плавающая «таблетка» с главными разделами
 * (Главная, Персонажи, Настройки) и профилем — аватаром справа. Поиск — в шапке.
 * У выбранного раздела подложка проявляется и подпись раскрывается анимацией, у остальных — только иконка.
 * «Профиль» после входа открывает свою страницу профиля, без входа — экран гостя со входом (`/me`).
 * Под панелью — затемнение фона, чтобы список не спорил с ней.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { avatarUrl } from "../components/CommentCard";
import { LIBRARY_ROUTES } from "../components/LibraryList";
import { useI18n } from "../i18n/I18nContext";
import { ownProfileRoute, useMe } from "../lib/session";
import { Icon, type IconName } from "../ui";

interface NavItem {
  key: string;
  icon: IconName;
  labelKey: string;
  match: (p: string, own: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "home", icon: "home", labelKey: "nav.home", match: (p) => p === "/" || p.startsWith("/explore") || LIBRARY_ROUTES.some((r) => p.startsWith(r)) },
  { key: "characters", icon: "users", labelKey: "nav.characters", match: (p) => p.startsWith("/characters") },
  { key: "settings", icon: "settings", labelKey: "menu.settings", match: (p) => p.startsWith("/settings") },
  { key: "profile", icon: "user", labelKey: "nav.profile", match: (p, own) => p === "/me" || (!!own && p === own) },
];

/** Куда ведёт пункт панели (у профиля адрес зависит от входа). */
export function navRoute(key: string, own: string): string {
  switch (key) {
    case "home":
      return "/";
    case "characters":
      return "/characters";
    case "settings":
      return "/settings";
    default:
      return own || "/me";
  }
}

/** Номер раздела нижней панели для пути (или -1) — по нему выбирается направление сдвига между разделами. */
export function navIndex(pathname: string, own: string): number {
  return NAV_ITEMS.findIndex((x) => x.match(pathname, own));
}

export function BottomNav() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const me = useMe();
  const own = ownProfileRoute(me);
  const avatar = me?.avatar_url ? avatarUrl(me.avatar_url) : "";

  return (
    <>
      <div className="ax-nav-backdrop" />
      <nav className="ax-nav" aria-label={t("nav.home")}>
        <div className="ax-nav-pill">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname, own);
            const route = navRoute(item.key, own);
            const isAvatar = item.key === "profile" && !!avatar;
            return (
              <button
                key={item.key}
                type="button"
                className={active ? "ax-nav-item is-active" : "ax-nav-item"}
                aria-label={t(item.labelKey)}
                aria-current={active ? "page" : undefined}
                onClick={() => pathname !== route && navigate(route)}
              >
                <span className="ax-nav-icon">
                  {isAvatar ? <img className="ax-nav-avatar" src={avatar} alt="" /> : <Icon name={item.icon} size={24} />}
                </span>
                <span className="ax-nav-label">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
