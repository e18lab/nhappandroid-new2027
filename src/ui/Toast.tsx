/**
 * Тосты — перенос `components/ToastProvider.tsx`: одна карточка снизу по центру,
 * всплывает (180ms), скрывается по тапу или через `durationMs` (по умолчанию 3,2 с).
 * Рамка: ошибка — красная, успех — акцентная, инфо — нейтральная.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastType = "error" | "success" | "info";

export interface ToastOptions {
  type?: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const HIDE_MS = 160;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number; type: ToastType }) | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const hideToast = useCallback(() => {
    clear();
    setShown(false);
    timer.current = window.setTimeout(() => setToast(null), HIDE_MS);
  }, []);

  const showToast = useCallback(
    (opts: ToastOptions) => {
      clear();
      setToast({ ...opts, type: opts.type ?? "info", id: Date.now() });
      setShown(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      timer.current = window.setTimeout(hideToast, opts.durationMs ?? 3200);
    },
    [hideToast],
  );

  useEffect(() => clear, []);

  const value = useMemo(() => ({ showToast, hideToast }), [showToast, hideToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <div className="ui-toast-wrap" aria-live="polite">
          <button
            key={toast.id}
            type="button"
            className={`ui-toast ui-toast-${toast.type}${shown ? " is-shown" : ""}`}
            onClick={hideToast}
          >
            <span className="ui-toast-title">{toast.title}</span>
            {toast.message ? <span className="ui-toast-message">{toast.message}</span> : null}
          </button>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
