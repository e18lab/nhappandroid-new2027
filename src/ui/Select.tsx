/**
 * Выбор из плоского списка — перенос `components/uikit/Select.tsx`.
 * В поле: подпись сверху, значение крупно, стрелка; описание и ошибка под полем.
 * Панель открывается вниз или вверх — где больше места.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackHandler } from "../shell/androidBack";
import { Icon } from "./Icon";
import { measure, placePanel } from "./popover";
import { ResetButton } from "./ResetButton";

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectProps {
  label?: string;
  description?: string;
  value?: string | number | null;
  options: SelectOption[];
  onChange?: (value: string | number) => void;
  defaultValue?: string | number;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  resetText?: string;
}

const PANEL_MAX_H = 320;
const OPTION_H = 44;

export function Select({
  label,
  description,
  value,
  options,
  onChange,
  defaultValue,
  disabled = false,
  placeholder = "Select…",
  error,
  resetText = "Reset",
}: SelectProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(() => measure(null));

  const strValue = value != null ? String(value) : undefined;
  const selected = options.find((o) => String(o.value) === strValue);
  const canReset = defaultValue !== undefined && strValue !== undefined && strValue !== String(defaultValue);

  useBackHandler(open, () => setOpen(false));

  const width = Math.max(anchor.w, 200);
  const pos = placePanel({
    anchor,
    width,
    estimatedHeight: options.length * OPTION_H + 12,
    maxHeight: PANEL_MAX_H,
    gap: 6,
  });

  return (
    <div className="ui-select">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        className={[
          "ui-select-trigger",
          open ? "is-open" : "",
          error ? "has-error" : "",
          disabled ? "ui-disabled" : "",
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setAnchor(measure(trigger.current));
          setOpen(true);
        }}
      >
        {(label || defaultValue !== undefined) && (
          <span className="ui-label-row">
            <span className="ui-select-label">{label}</span>
            {defaultValue !== undefined && (
              <ResetButton visible={canReset} text={resetText} onPress={() => onChange?.(defaultValue)} />
            )}
          </span>
        )}
        <span className="ui-select-value-line">
          <span className={selected ? "ui-select-value" : "ui-select-value ui-muted"}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={18} className="ui-select-arrow" />
        </span>
      </button>
      {description ? <p className="ui-description">{description}</p> : null}
      {error ? <p className="ui-error">{error}</p> : null}

      {open &&
        createPortal(
          <>
            <div className="ui-backdrop" onClick={() => setOpen(false)} />
            <div
              className="ui-select-panel"
              role="listbox"
              style={{ top: pos.top, left: pos.left, minWidth: width, maxHeight: pos.maxHeight }}
            >
              {options.map((opt) => {
                const active = String(opt.value) === strValue;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? "ui-select-option is-active" : "ui-select-option"}
                    onClick={() => {
                      onChange?.(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span className="ui-select-option-label">{opt.label}</span>
                    {active ? <Icon name="check" size={16} strokeWidth={2.5} className="ui-accent" /> : null}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
