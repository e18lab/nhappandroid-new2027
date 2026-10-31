/**
 * Библиотека — новый кит: строки-ссылки (загруженное, закладки, онлайн-избранное, история, теги,
 * рекомендации). Живёт на главной во вкладке «Моя». `ListRow` — общая строка списка в карточке.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { Icon, type IconName } from "../ui";

const LIBRARY: { labelKey: string; icon: IconName; route: string; needsLogin?: boolean }[] = [
  { labelKey: "menu.downloaded", icon: "download", route: "/downloaded" },
  { labelKey: "menu.favorites", icon: "bookmark", route: "/favorites" },
  { labelKey: "menu.favoritesOnline", icon: "heart", route: "/favorites-online", needsLogin: true },
  { labelKey: "menu.history", icon: "clock", route: "/history" },
  { labelKey: "menu.tags", icon: "tag", route: "/tags" },
  { labelKey: "menu.recommendations", icon: "star", route: "/recommendations" },
];

/** Маршруты библиотеки — в нижней панели они относятся к «Главной». */
export const LIBRARY_ROUTES = LIBRARY.map((x) => x.route);

export function ListRow({ icon, label, onPress, disabled, trailing }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; trailing?: ReactNode }) {
  return (
    <button type="button" className="ax-list-row" disabled={disabled} onClick={onPress}>
      <span className="ax-list-row-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="ax-list-row-label">{label}</span>
      {trailing ?? <Icon name={disabled ? "lock" : "chevron-right"} size={18} />}
    </button>
  );
}

export function LibraryList() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = useMe();
  return (
    <section className="ax-card ax-list-card">
      {LIBRARY.map((item) => (
        <ListRow key={item.route} icon={item.icon} label={t(item.labelKey)} disabled={item.needsLogin && !me} onPress={() => navigate(item.route)} />
      ))}
    </section>
  );
}
