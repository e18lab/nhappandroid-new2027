import { useEffect, useRef, useState } from "react";

/**
 * Картинка с перебором запасных адресов (перенос `SmartImageWithRetry` из старого приложения).
 * Ошибка → следующий адрес; список кончился → заново с первого, до `maxRetries` раз,
 * с паузой `retryDelay × (номер попытки)`. Пока грузится — спиннер, после всех попыток — пустая заглушка.
 */
export function SmartImage({
  sources,
  alt = "",
  fit = "cover",
  maxRetries = 3,
  retryDelay = 1000,
  showLoader = true,
  eager = false,
}: {
  sources: string[];
  alt?: string;
  fit?: "cover" | "contain";
  maxRetries?: number;
  retryDelay?: number;
  showLoader?: boolean;
  /** Грузить сразу, а не когда картинка подъедет к экрану. */
  eager?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<"loading" | "loaded" | "failed">(() =>
    sources.length ? "loading" : "failed",
  );
  const timer = useRef<number | null>(null);
  const key = sources.join("\n");
  const shownKey = useRef(key);

  // Сброс только при смене адресов (сравниваем по содержимому), не при монтировании:
  // картинка из кеша успевает вызвать onLoad раньше эффекта, и сброс вернул бы спиннер навсегда.
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    clearTimer();
    setIndex(0);
    setRetry(0);
    setState(sources.length ? "loading" : "failed");
  }, [key, sources.length]);

  useEffect(() => clearTimer, []);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function onError() {
    clearTimer();
    if (index + 1 < sources.length) {
      setIndex(index + 1);
      return;
    }
    if (retry < maxRetries) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setRetry((n) => n + 1);
        setIndex(0);
      }, retryDelay * (retry + 1));
      return;
    }
    setState("failed");
  }

  const src = sources[index];

  return (
    <div className="smart-image">
      {src && state !== "failed" && (
        <img
          key={`${src}#${retry}`}
          ref={(el) => {
            // Страховка: загруженная до подписки картинка не присылает onLoad повторно.
            if (el?.complete && el.naturalWidth > 0 && state === "loading") setState("loaded");
          }}
          className={state === "loaded" ? "smart-image-img is-loaded" : "smart-image-img"}
          style={{ objectFit: fit }}
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => {
            clearTimer();
            setState("loaded");
          }}
          onError={onError}
        />
      )}
      {showLoader && state === "loading" && (
        <div className="smart-image-overlay" aria-hidden="true">
          <span className="spinner" />
        </div>
      )}
      {state === "failed" && <div className="smart-image-failed" role="img" aria-label={alt} />}
    </div>
  );
}
