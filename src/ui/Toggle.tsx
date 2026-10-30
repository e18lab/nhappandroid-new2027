/**
 * Переключатель-карточка — перенос `components/uikit/Toggle.tsx`:
 * подпись сверху, ниже текст состояния и галочка/минус; необязательный сброс и описание.
 */
import { Icon } from "./Icon";
import { ResetButton } from "./ResetButton";

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  enabledText?: string;
  disabledText?: string;
  /** При отличии value от defaultValue справа от подписи появляется «сброс». */
  defaultValue?: boolean;
  resetText?: string;
  description?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function Toggle({
  value,
  onValueChange,
  label,
  enabledText = "Включено",
  disabledText = "Выключено",
  defaultValue,
  resetText = "Reset",
  description,
  disabled = false,
  accessibilityLabel,
}: ToggleProps) {
  const stateText = value ? enabledText : disabledText;
  return (
    <div className="ui-field">
      <div
        role="switch"
        tabIndex={disabled ? -1 : 0}
        aria-checked={value}
        aria-disabled={disabled || undefined}
        aria-label={accessibilityLabel ?? `${label}, ${stateText}`}
        className={disabled ? "ui-toggle ui-disabled" : "ui-toggle"}
        onClick={() => !disabled && onValueChange(!value)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            onValueChange(!value);
          }
        }}
      >
        <div className="ui-label-row">
          <span className="ui-label">{label}</span>
          {defaultValue !== undefined && (
            <ResetButton
              visible={value !== defaultValue}
              text={resetText}
              onPress={() => onValueChange(defaultValue)}
            />
          )}
        </div>
        <div className="ui-toggle-value">
          <span className={value ? "ui-toggle-state" : "ui-toggle-state ui-toggle-off"}>{stateText}</span>
          <span className={value ? "ui-toggle-mark ui-toggle-mark-on" : "ui-toggle-mark"}>
            <Icon name={value ? "check" : "minus"} size={18} strokeWidth={2.5} />
          </span>
        </div>
      </div>
      {description ? <p className="ui-description">{description}</p> : null}
    </div>
  );
}
