/**
 * Ввод значения в панели, прижатой к верхнему краю клавиатуры, — перенос `components/uikit/KeyInputModal.tsx`.
 * Высоту клавиатуры берём из `visualViewport`; когда клавиатура закрылась — закрываемся, как в старом.
 */
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useBackHandler } from "../shell/androidBack";

export interface KeyInputModalProps {
  visible: boolean;
  onClose: () => void;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: (value: string) => void;
  label?: string;
  showLabel?: boolean;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  selectTextOnFocus?: boolean;
  autoFocus?: boolean;
}

/** Насколько клавиатура перекрывает окно снизу. */
function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

export function KeyInputModal({
  visible,
  onClose,
  value,
  onChangeText,
  onSubmit,
  label,
  showLabel = true,
  placeholder,
  inputMode = "text",
  selectTextOnFocus = false,
  autoFocus = true,
}: KeyInputModalProps) {
  const [inset, setInset] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const sawKeyboard = useRef(false);

  useBackHandler(visible, onClose);

  useEffect(() => {
    if (!visible) {
      setInset(0);
      sawKeyboard.current = false;
      return;
    }
    const vv = window.visualViewport;
    const update = () => {
      const h = keyboardInset();
      setInset(h);
      if (h > 80) sawKeyboard.current = true;
      else if (sawKeyboard.current) onClose(); // клавиатуру убрали — закрываемся
    };
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    const focusTimer = autoFocus ? window.setTimeout(() => input.current?.focus(), 100) : undefined;
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.clearTimeout(focusTimer);
    };
  }, [visible, autoFocus, onClose]);

  if (!visible) return null;

  const done = () => {
    onSubmit?.(value);
    onClose();
  };

  return createPortal(
    <div className="ui-keyinput-root">
      <div className="ui-backdrop ui-keyinput-dim" onClick={onClose} />
      <div className="ui-keyinput-bar" style={{ bottom: inset }}>
        {showLabel && label ? <span className="ui-keyinput-label">{label}</span> : null}
        <input
          ref={input}
          className="ui-keyinput-input"
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          enterKeyHint="done"
          onChange={(e) => onChangeText(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            if (selectTextOnFocus) el.select();
            else el.setSelectionRange(el.value.length, el.value.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") done();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
