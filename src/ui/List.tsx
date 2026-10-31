/**
 * Списки нового кита (по образцу настроек Telegram): карточка-группа с заголовком цвета акцента,
 * пункт с объёмной цветной иконкой, переключатель на всю строку, радиокнопка, поле без рамки, пояснение.
 * Стили — `.set-*` в kit.css.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Карточка-группа с необязательным заголовком цвета акцента. `padded` — для произвольного содержимого. */
export function ListGroup({ title, padded, children }: { title?: string; padded?: boolean; children: ReactNode }) {
  return (
    <section className={padded ? "set-group set-pad" : "set-group"}>
      {title && <div className="set-group-title">{title}</div>}
      {children}
    </section>
  );
}

/** Пояснение под карточкой. */
export function ListHint({ children }: { children: ReactNode }) {
  return <p className="set-hint">{children}</p>;
}

/** Объёмная цветная иконка в скруглённом квадрате (`color` — основной цвет градиента). */
export function TileIcon({ icon, color, size = 22 }: { icon: IconName; color: string; size?: number }) {
  return (
    <span className="set-row-icon" style={{ "--c": color } as CSSProperties}>
      <Icon name={icon} size={size} />
    </span>
  );
}

/** Пункт списка: иконка, заголовок, подпись, справа шеврон (или своё). */
export function ListRow({
  icon,
  color,
  title,
  sub,
  trailing,
  onPress,
}: {
  icon?: IconName;
  color?: string;
  title: string;
  sub?: string;
  trailing?: ReactNode;
  onPress: () => void;
}) {
  return (
    <button type="button" className="set-row" onClick={onPress}>
      {icon && <TileIcon icon={icon} color={color ?? "#888"} />}
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      <span className="set-row-trail">{trailing ?? <Icon name="chevron-right" size={18} />}</span>
    </button>
  );
}

/** Переключатель: срабатывает от нажатия на всю строку. */
export function SwitchRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="switch-row set-switch" onClick={() => onChange(!value)}>
      <div className="switch-row-text">
        <div className="switch-row-title">{title}</div>
        {description && <div className="switch-row-desc">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={title}
        className={value ? "android-switch is-on" : "android-switch"}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!value);
        }}
      >
        <span className="android-switch-track" />
        <span className="android-switch-thumb" />
      </button>
    </div>
  );
}

/** Строка с радиокнопкой слева (выбор одного из списка). */
export function RadioRow({ title, sub, checked, onSelect }: { title: string; sub?: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="set-row set-radio-row" onClick={onSelect}>
      <span className={checked ? "set-radio is-on" : "set-radio"} />
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
    </button>
  );
}

/** Поле ввода внутри карточки: без рамки, подсказка — плейсхолдером, между соседними полями черта. */
export function ListField({
  value,
  onChange,
  multiline,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: "text" | "email" | "password";
  placeholder?: string;
}) {
  return (
    <label className="acc-field">
      {multiline ? (
        <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

/** Число со ступенчатым изменением: строка с подписью, справа «− значение +». */
export function StepperRow({
  title,
  sub,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  title: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="set-row set-stepper-row">
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      <span className="set-stepper">
        <button type="button" aria-label="−" disabled={value <= min} onClick={() => set(value - step)}>
          <Icon name="minus" size={18} />
        </button>
        <span className="set-stepper-value">{format(value)}</span>
        <button type="button" aria-label="+" disabled={value >= max} onClick={() => set(value + step)}>
          <Icon name="plus" size={18} />
        </button>
      </span>
    </div>
  );
}
