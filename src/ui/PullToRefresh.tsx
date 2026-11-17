/**
 * «Потяните, чтобы обновить» — телефон: тянем ленту вниз от самого верха, сверху выезжает плашка с кольцом.
 * Дотянули до порога — плашка становится акцентной («Отпустите, чтобы обновить»), отпустили — крутится,
 * пока `onRefresh` не закончит. На ПК не включается (там кнопки «Обновить»).
 *
 * Жест читается прямо с элемента прокрутки (`ref`), во время протяжки плашка двигается без перерисовки React.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nContext";
import { IS_DESKTOP } from "../lib/platform";
import { tapFeedback } from "./haptics";
import { Icon } from "./Icon";

type Phase = "idle" | "pull" | "release" | "refreshing";

/** Сколько протянуть (после «резины»), чтобы обновить. */
const THRESHOLD = 72;
/** Дальше плашка не едет. */
const MAX = 120;
/** Где плашка стоит, пока обновляется. */
const REST = 84;
/** Кольцо: длина окружности r=11. */
const RING = 2 * Math.PI * 11;

export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown> | unknown, enabled = true) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const pill = useRef<HTMLDivElement>(null);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  // Элемент прокрутки может появиться позже (экран сначала показывал заглушку) — следим за ним
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (ref.current !== el) setEl(ref.current);
  });

  useEffect(() => {
    if (!el || IS_DESKTOP || !enabled) return;
    let x0 = 0;
    let y0 = 0;
    let tracking = false;
    let pulling = false;
    let armed = false;
    let busy = false;
    let dist = 0;

    let clearTimer = 0;
    const paint = (d: number, animate: boolean) => {
      // Лента едет вниз вместе с плашкой — плашка встаёт в открывшийся зазор под шапкой
      window.clearTimeout(clearTimer);
      el.style.transition = animate ? "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
      el.style.transform = d > 0 ? `translateY(${Math.min(d, MAX)}px)` : "";
      if (d <= 0) {
        clearTimer = window.setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, 320);
      }
      const p = pill.current;
      if (!p) return;
      p.style.transition = animate ? "" : "none";
      p.style.setProperty("--ptr-y", `${Math.min(d, MAX)}px`);
      p.style.setProperty("--ptr-p", String(Math.min(1, d / THRESHOLD)));
    };
    const hide = () => {
      armed = false;
      dist = 0;
      setPhase("idle");
      paint(0, true);
    };

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || el.scrollTop > 0) return;
      tracking = true;
      pulling = false;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!pulling) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // Вбок — это листание страниц, вверх — обычная прокрутка
        if (dy <= 0 || Math.abs(dx) > dy || el.scrollTop > 0) {
          tracking = false;
          return;
        }
        pulling = true;
        y0 = e.touches[0].clientY;
        // Шапка лежит поверх ленты (у ленты отступ сверху под неё) — плашка выезжает из-под шапки
        const top = el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).paddingTop) || 0);
        pill.current?.style.setProperty("--ptr-top", `${Math.max(0, top)}px`);
        setPhase("pull");
      }
      if (e.cancelable) e.preventDefault();
      const raw = Math.max(0, e.touches[0].clientY - y0);
      // «Резина»: чем дальше, тем туже
      dist = MAX * (1 - Math.exp(-raw / (MAX * 1.6)));
      paint(dist, false);
      const now = dist >= THRESHOLD;
      if (now !== armed) {
        armed = now;
        setPhase(now ? "release" : "pull");
        if (now) tapFeedback();
      }
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!pulling) return;
      pulling = false;
      if (!armed) return hide();
      busy = true;
      setPhase("refreshing");
      paint(REST, true);
      const started = Date.now();
      Promise.resolve()
        .then(() => cb.current())
        .catch(() => undefined)
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started)))))
        .then(() => {
          busy = false;
          hide();
        });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      window.clearTimeout(clearTimer);
      el.style.transition = "";
      el.style.transform = "";
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [el, enabled]);

  if (IS_DESKTOP || !enabled) return null;
  const label = phase === "release" ? t("ptr.release") : phase === "refreshing" ? t("ptr.refreshing") : t("ptr.pull");
  return createPortal(
    <div ref={pill} className={`ptr is-${phase}`} aria-hidden={phase === "idle"} role="status">
      <span className="ptr-ring">
        <svg viewBox="0 0 28 28" aria-hidden>
          <circle className="ptr-track" cx="14" cy="14" r="11" />
          <circle className="ptr-fill" cx="14" cy="14" r="11" style={{ strokeDasharray: RING }} />
        </svg>
        <span className="ptr-arrow">
          <Icon name="arrow-down" size={14} />
        </span>
      </span>
      <span className="ptr-text">{label}</span>
    </div>,
    document.body,
  );
}
