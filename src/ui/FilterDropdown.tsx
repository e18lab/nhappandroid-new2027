/**
 * Выпадающее меню фильтров — перенос `components/uikit/FilterDropdown.tsx`.
 *
 * Элементы: опция (с радио/квадратом или иконкой справа), действие, заголовок группы,
 * подменю (стек уровней со строкой «назад») и произвольный контент (`custom`),
 * который может открыть свой список-выбор через `openSubmenu` (например год/месяц в календаре).
 * Позиция фиксируется при открытии; высота плавно меняется при переходах между уровнями.
 */
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackHandler } from "../shell/androidBack";
import { Icon } from "./Icon";
import { measure, placePanel, SCREEN_MARGIN, type Anchor } from "./popover";

type IconProp = ReactNode | ((color: string) => ReactNode);

export type SelectOption = {
  value: string;
  label: string;
  icon?: IconProp;
  indicatorShape?: "circle" | "square";
  /** Справа вместо радио. */
  trailingIcon?: IconProp;
};

export type SelectAction = {
  type: "action";
  label: string;
  icon?: IconProp;
  onPress: () => void;
};

export type SelectGroupLabel = {
  type: "group";
  label: string;
  /** Вместо текста `label` (label остаётся для расчёта ширины). */
  labelNode?: ReactNode;
  subtitle?: ReactNode;
};

export type SelectSubmenu = {
  type: "submenu";
  label: string;
  /** Текст строки «назад» внутри подменю. */
  backLabel?: string;
  icon?: IconProp;
  children: SelectItem[];
};

export type CustomContentProps = {
  onClose: () => void;
  openSubmenu: (title: string, items: { value: string; label: string }[]) => Promise<string | null>;
};

export type SelectCustom = {
  type: "custom";
  label: string;
  backLabel?: string;
  preferredHeight?: number;
  content: (props: CustomContentProps) => ReactNode;
};

export type SelectItem = SelectOption | SelectAction | SelectGroupLabel | SelectSubmenu | SelectCustom;

export interface FilterDropdownProps {
  value?: string;
  /** Опции с этим значением тоже показываются выбранными. */
  secondaryValue?: string;
  onChange?: (value: string) => void;
  options: SelectItem[];
  label?: string;
  placeholder?: string;
  resetLabel?: string;
  onReset?: () => void;
  disabled?: boolean;
  variant?: "secondary" | "outline" | "ghost" | "chip";
  width?: CSSProperties["width"];
  minWidth?: CSSProperties["minWidth"];
  maxWidth?: CSSProperties["maxWidth"];
  maxDropdownHeight?: number;
  keepOpen?: boolean;
  hideRadio?: boolean;
  trigger?: (props: { open: boolean; onPress: () => void }) => ReactNode;
  description?: string;
}

const DROPDOWN_PAD = 6;
const ITEM_HEIGHT = 44;
const GROUP_HEIGHT = 30;
const BACK_ROW_HEIGHT = 40;
const RESET_ROW_HEIGHT = 28;
const RADIO_SIZE = 18;
const FADE_OUT_MS = 90;
const FADE_IN_MS = 130;

type Level =
  | { type: "list"; items: SelectItem[]; label: string }
  | { type: "custom"; label: string; preferredHeight?: number; content: SelectCustom["content"] }
  | { type: "picker"; label: string; items: SelectOption[]; resolve: (v: string | null) => void };

const isKind = <K extends string>(item: SelectItem, kind: K): boolean =>
  "type" in item && (item as { type: string }).type === kind;

function findLabel(items: SelectItem[], value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const item of items) {
    if (!("type" in item) && item.value === value) return item.label;
    if (isKind(item, "submenu")) {
      const found = findLabel((item as SelectSubmenu).children, value);
      if (found) return found;
    }
  }
  return undefined;
}

function allLabels(items: SelectItem[]): string[] {
  return items.flatMap((item) => [
    item.label,
    ...(isKind(item, "submenu") ? allLabels((item as SelectSubmenu).children) : []),
  ]);
}

function iconNode(icon: IconProp | undefined): ReactNode {
  return typeof icon === "function" ? icon("currentColor") : icon;
}

/** Оценка высоты списка, как в старом (для выбора стороны и анимации высоты). */
function estimateListHeight(items: SelectItem[]): number {
  let h = 0;
  for (const item of items) {
    if (isKind(item, "group")) {
      const g = item as SelectGroupLabel;
      h += GROUP_HEIGHT;
      if (g.labelNode != null) h += 36;
      if (typeof g.subtitle === "string" && g.subtitle.trim()) h += 44;
      else if (g.subtitle != null && typeof g.subtitle !== "string") h += 56;
    } else h += ITEM_HEIGHT;
  }
  return h;
}

export function FilterDropdown({
  value,
  secondaryValue,
  onChange,
  options,
  label,
  placeholder = "Select…",
  resetLabel,
  onReset,
  disabled = false,
  variant = "outline",
  width,
  minWidth = 140,
  maxWidth,
  maxDropdownHeight = 300,
  keepOpen = false,
  hideRadio = false,
  trigger: customTrigger,
  description,
}: FilterDropdownProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<Level[]>([]);
  const [fading, setFading] = useState(false);
  const [lock, setLock] = useState<{ anchor: Anchor; top: number; left: number; width: number; opensBelow: boolean } | null>(null);
  const transitioning = useRef(false);

  const top = stack[stack.length - 1] ?? null;
  const items: SelectItem[] = top?.type === "list" || top?.type === "picker" ? top.items : options;
  const showingCustom = top?.type === "custom";
  // Свой контент остаётся смонтированным, пока поверх него открыт выбор (picker), — как в старом.
  const customLevel =
    top?.type === "custom"
      ? top
      : top?.type === "picker" && stack[stack.length - 2]?.type === "custom"
        ? (stack[stack.length - 2] as Extract<Level, { type: "custom" }>)
        : null;

  const close = useCallback(() => {
    setOpen(false);
    setStack([]);
    setLock(null);
    setFading(false);
    transitioning.current = false;
  }, []);

  const transition = useCallback((change: () => void) => {
    if (transitioning.current) {
      change();
      return;
    }
    transitioning.current = true;
    setFading(true);
    window.setTimeout(() => {
      change();
      requestAnimationFrame(() => {
        setFading(false);
        window.setTimeout(() => {
          transitioning.current = false;
        }, FADE_IN_MS);
      });
    }, FADE_OUT_MS);
  }, []);

  const push = (level: Level) => transition(() => setStack((s) => [...s, level]));
  const pop = () => transition(() => setStack((s) => s.slice(0, -1)));

  const openSubmenu = useCallback(
    (title: string, list: { value: string; label: string }[]) =>
      new Promise<string | null>((resolve) => {
        transition(() =>
          setStack((s) => [...s, { type: "picker", label: title, items: list.map((x) => ({ ...x })), resolve }]),
        );
      }),
    [transition],
  );

  const back = () => {
    if (top?.type === "picker") top.resolve(null);
    pop();
  };

  useBackHandler(open, () => (stack.length > 0 ? back() : close()));

  const openMenu = () => {
    if (disabled) return;
    const anchor = measure(triggerRef.current);
    const longest = allLabels(options).reduce((m, l) => Math.max(m, l.length), 0);
    const estimatedTextW = longest * 9 + 14 * 2 + 28 + (hideRadio ? 8 : RADIO_SIZE) + 20;
    const w = Math.min(Math.max(anchor.w, estimatedTextW, 180), window.innerWidth - SCREEN_MARGIN * 2);
    const estimated =
      estimateListHeight(options) + DROPDOWN_PAD * 2 + (resetLabel ? RESET_ROW_HEIGHT : 0);
    const pos = placePanel({ anchor, width: w, estimatedHeight: estimated, maxHeight: maxDropdownHeight, gap: 4 });
    setStack([]);
    setFading(false);
    transitioning.current = false;
    setLock({ anchor, top: pos.top, left: pos.left, width: w, opensBelow: pos.opensBelow });
    setOpen(true);
  };

  const select = (val: string) => {
    if (top?.type === "picker") {
      top.resolve(val);
      pop();
      return;
    }
    onChange?.(val);
    if (!keepOpen) close();
  };

  // Высота панели для текущего уровня
  let panelHeight = maxDropdownHeight;
  let panelWidth = lock?.width ?? 180;
  if (lock) {
    const room = lock.opensBelow
      ? window.innerHeight - lock.anchor.y - lock.anchor.h - SCREEN_MARGIN
      : lock.anchor.y - SCREEN_MARGIN;
    const preferred = customLevel?.preferredHeight;
    const cap = Math.min(showingCustom ? (preferred ?? maxDropdownHeight) : maxDropdownHeight, Math.max(room, 100));
    const chrome =
      (stack.length > 0 ? BACK_ROW_HEIGHT : 0) + (resetLabel && stack.length === 0 ? RESET_ROW_HEIGHT : 0) + DROPDOWN_PAD * 2;
    panelHeight = showingCustom
      ? preferred != null
        ? Math.min(preferred, cap)
        : cap
      : Math.min(estimateListHeight(items) + chrome, cap);
    if (showingCustom) panelWidth = Math.max(panelWidth, Math.min(280, window.innerWidth - SCREEN_MARGIN * 2));
  }
  // Вверх раскрываемся от нижнего края, чтобы при смене высоты панель не «прыгала» от кнопки.
  const panelStyle: CSSProperties = lock
    ? lock.opensBelow
      ? { top: lock.top, left: lock.left, width: panelWidth, maxHeight: panelHeight }
      : { bottom: window.innerHeight - lock.anchor.y + 4, left: lock.left, width: panelWidth, maxHeight: panelHeight }
    : {};
  if (customLevel?.preferredHeight != null) panelStyle.height = panelHeight;

  const selectedLabel = findLabel(options, value);

  const renderItem = (item: SelectItem, idx: number) => {
    if (isKind(item, "group")) {
      const g = item as SelectGroupLabel;
      return (
        <div key={`g-${idx}`} className="ui-dd-group">
          {g.labelNode != null ? <div className="ui-dd-group-node">{g.labelNode}</div> : <div className="ui-dd-group-label">{g.label}</div>}
          {g.subtitle != null && g.subtitle !== "" ? <div className="ui-dd-group-sub">{g.subtitle}</div> : null}
        </div>
      );
    }
    if (isKind(item, "submenu") || isKind(item, "custom")) {
      const sub = item as SelectSubmenu | SelectCustom;
      const onPress = () => {
        if (sub.type === "custom") {
          push({ type: "custom", label: sub.backLabel ?? sub.label, preferredHeight: sub.preferredHeight, content: sub.content });
          return;
        }
        const only = sub.children.length === 1 && isKind(sub.children[0], "custom") ? (sub.children[0] as SelectCustom) : null;
        push(
          only
            ? { type: "custom", label: only.backLabel ?? sub.label, preferredHeight: only.preferredHeight, content: only.content }
            : { type: "list", items: sub.children, label: sub.backLabel ?? sub.label },
        );
      };
      return (
        <button key={`s-${idx}`} type="button" className="ui-dd-option" onClick={onPress}>
          {"icon" in sub && sub.icon ? <span className="ui-dd-icon">{iconNode(sub.icon)}</span> : null}
          <span className="ui-dd-text">{sub.label}</span>
          <Icon name="chevron-right" size={16} className="ui-muted" />
        </button>
      );
    }
    if (isKind(item, "action")) {
      const act = item as SelectAction;
      return (
        <button
          key={`a-${idx}`}
          type="button"
          className="ui-dd-option"
          onClick={() => {
            act.onPress();
            close();
          }}
        >
          {act.icon ? <span className="ui-dd-icon">{iconNode(act.icon)}</span> : null}
          <span className="ui-dd-text">{act.label}</span>
        </button>
      );
    }
    const opt = item as SelectOption;
    const selected = opt.value === value || (secondaryValue != null && opt.value === secondaryValue);
    const square = opt.indicatorShape === "square";
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={selected}
        className={selected ? "ui-dd-option is-selected" : "ui-dd-option"}
        onClick={() => select(opt.value)}
      >
        {opt.icon ? <span className="ui-dd-icon">{iconNode(opt.icon)}</span> : null}
        <span className="ui-dd-text">{opt.label}</span>
        {opt.trailingIcon ? (
          <span className="ui-dd-icon ui-dd-trailing ui-accent">{iconNode(opt.trailingIcon)}</span>
        ) : hideRadio ? null : (
          <span className={`ui-dd-radio${square ? " is-square" : ""}${selected ? " is-on" : ""}`}>
            {selected ? <span className="ui-dd-radio-dot" /> : null}
          </span>
        )}
      </button>
    );
  };

  const canReset = onReset != null && resetLabel != null;

  return (
    <div className="ui-dd">
      {(label || canReset) && (
        <div className="ui-label-row ui-dd-label-row">
          <span className="ui-dd-label">{label}</span>
          {canReset ? (
            <button type="button" className="ui-reset" onClick={onReset}>
              {resetLabel}
            </button>
          ) : null}
        </div>
      )}

      <div ref={triggerRef} className="ui-dd-anchor">
        {customTrigger ? (
          customTrigger({ open, onPress: openMenu })
        ) : (
          <button
            type="button"
            disabled={disabled}
            className={`ui-dd-trigger ui-dd-${variant}${open ? " is-open" : ""}${disabled ? " ui-disabled" : ""}`}
            style={{ width, minWidth, maxWidth }}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={openMenu}
          >
            <span className={selectedLabel ? "ui-dd-trigger-text" : "ui-dd-trigger-text ui-muted"}>
              {selectedLabel ?? placeholder}
            </span>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
          </button>
        )}
      </div>
      {description ? <p className="ui-description ui-dd-description">{description}</p> : null}

      {open &&
        lock &&
        createPortal(
          <>
            <div className="ui-backdrop" onClick={close} />
            <div className="ui-dd-menu" role="menu" style={panelStyle}>
              {stack.length > 0 && (
                <button type="button" className="ui-dd-back" onClick={back}>
                  <Icon name="arrow-left" size={16} />
                  <span>{top?.label}</span>
                </button>
              )}
              {resetLabel && stack.length === 0 && (
                <button
                  type="button"
                  className="ui-dd-reset-row"
                  onClick={() => {
                    onReset?.();
                    close();
                  }}
                >
                  {resetLabel}
                </button>
              )}
              <div className={fading ? "ui-dd-body is-fading" : "ui-dd-body"}>
                {customLevel ? (
                  <div className="ui-dd-scroll" style={{ display: top?.type === "custom" ? undefined : "none" }}>
                    {customLevel.content({ onClose: close, openSubmenu })}
                  </div>
                ) : null}
                {top?.type !== "custom" ? <div className="ui-dd-scroll">{items.map(renderItem)}</div> : null}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
