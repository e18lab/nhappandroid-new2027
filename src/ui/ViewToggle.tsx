/**
 * Сегментный переключатель режимов (список/сетка) — перенос `components/uikit/ViewToggle.tsx`.
 * Кнопки 36×36, акцентный индикатор плавно переезжает под выбранную.
 */
import type { ReactNode } from "react";

export interface ViewToggleOption {
  value: string;
  icon?: ReactNode | ((color: string) => ReactNode);
  label?: string;
}

const BUTTON_SIZE = 36;
const PAD = 4;

export function ViewToggle({
  options,
  value,
  onChange,
  description,
  disabled = false,
  accessibilityLabel,
}: {
  options: ViewToggleOption[];
  value: string;
  onChange: (value: string) => void;
  description?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="ui-view-toggle-wrap">
      <div className={disabled ? "ui-view-toggle ui-disabled" : "ui-view-toggle"} role="tablist" aria-label={accessibilityLabel}>
        <span className="ui-view-toggle-indicator" style={{ left: PAD + index * BUTTON_SIZE }} />
        {options.map((opt) => {
          const active = opt.value === value;
          const icon = typeof opt.icon === "function" ? opt.icon("currentColor") : opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={opt.label ?? opt.value}
              disabled={disabled}
              className={active ? "ui-view-toggle-btn is-active" : "ui-view-toggle-btn"}
              onClick={() => onChange(opt.value)}
            >
              {icon ?? <span className="ui-view-toggle-text">{opt.label ?? opt.value}</span>}
            </button>
          );
        })}
      </div>
      {description ? <p className="ui-description">{description}</p> : null}
    </div>
  );
}
