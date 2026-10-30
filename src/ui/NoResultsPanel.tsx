/**
 * Плашка «ничего не найдено» — перенос `components/NoResultsPanel.tsx`:
 * иконка и заголовок, подзаголовок, кнопки-действия чипами.
 */
import { Icon, type IconName } from "./Icon";

export interface NoResultsAction {
  label: string;
  onPress: () => void;
}

export function NoResultsPanel({
  title,
  subtitle,
  iconName = "info",
  actions = [],
}: {
  title: string;
  subtitle?: string;
  iconName?: IconName;
  actions?: NoResultsAction[];
}) {
  return (
    <div className="ui-noresults">
      <div className="ui-noresults-title">
        <Icon name={iconName} size={16} className="ui-accent" />
        <span>{title}</span>
      </div>
      {subtitle ? <p className="ui-noresults-subtitle">{subtitle}</p> : null}
      {actions.length > 0 && (
        <div className="ui-noresults-actions">
          {actions.map((a, i) => (
            <button key={`${a.label}-${i}`} type="button" className="ui-noresults-chip" onClick={a.onPress}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
