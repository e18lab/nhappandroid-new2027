/**
 * Свайп «назад» как в Telegram: ведёшь пальцем вправо по внутреннему экрану — он уменьшается,
 * скругляет углы и едет за пальцем, а под ним проступает предыдущий экран (сдвинут на четверть влево
 * и затемнён, по мере свайпа встаёт на место). Отпустил дальше трети ширины или быстрым движением —
 * экран уезжает вправо и происходит шаг назад; иначе — возвращается на место.
 *
 * Хук только двигает DOM (без перерисовки React на каждый кадр): верхний слой — `.ax-layer.is-top`,
 * нижний — `.ax-layer.is-under` (его монтирует Shell по `onStart`).
 * Не срабатывает, если палец начал на ползунке или на полосе, которую можно прокрутить влево.
 */
import { useEffect, useRef, type RefObject } from "react";

/** Сколько пикселей движения нужно, чтобы понять направление жеста. */
const SLOP = 10;
/** Уменьшение экрана и скругление углов на пике жеста. */
const SCALE = 0.92;
const RADIUS = 28;
/** Сдвиг и затемнение нижнего экрана в начале. */
const UNDER_SHIFT = 0.25;
const UNDER_DIM = 0.35;
const SETTLE_MS = 240;

function canScrollLeft(target: Element | null, stop: Element): boolean {
  for (let el = target; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && el.scrollLeft > 0) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

export function useSwipeBack({
  stack,
  enabled,
  onStart,
  onCommit,
  onCancel,
}: {
  stack: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onStart: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const cb = useRef({ onStart, onCommit, onCancel });
  cb.current = { onStart, onCommit, onCancel };

  useEffect(() => {
    const root = stack.current;
    if (!enabled || !root) return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let state: "idle" | "pending" | "drag" | "settling" = "idle";

    const top = () => root.querySelector<HTMLElement>(".ax-layer.is-top");
    const under = () => root.querySelector<HTMLElement>(".ax-layer.is-under");

    const paint = (dx: number, animate: boolean) => {
      const w = root.clientWidth || 1;
      const p = Math.min(Math.max(dx / w, 0), 1);
      const shrink = Math.min(1, p * 4); // уменьшение набирается в первой четверти жеста
      const t = top();
      const u = under();
      const transition = animate ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.75, 0.25, 1), border-radius ${SETTLE_MS}ms` : "none";
      if (t) {
        t.style.transition = transition;
        t.style.transform = `translateX(${dx}px) scale(${1 - (1 - SCALE) * shrink})`;
        t.style.borderRadius = `${RADIUS * shrink}px`;
      }
      if (u) {
        u.style.transition = animate ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.75, 0.25, 1)` : "none";
        u.style.transform = `translateX(${-UNDER_SHIFT * 100 * (1 - p)}%)`;
        u.style.setProperty("--dim", String(UNDER_DIM * (1 - p)));
      }
    };

    const reset = () => {
      const t = top();
      if (t) {
        t.style.transition = "";
        t.style.transform = "";
        t.style.borderRadius = "";
        t.classList.remove("is-dragging");
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (state !== "idle" || e.touches.length !== 1) return;
      const target = e.target as Element;
      if (target.closest("input[type=range], textarea, .no-swipe-back") || canScrollLeft(target, root)) return;
      startX = lastX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastT = e.timeStamp;
      velocity = 0;
      state = "pending";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (state !== "pending" && state !== "drag") return;
      const x = e.touches[0].clientX;
      const dx = x - startX;
      const dy = e.touches[0].clientY - startY;
      if (state === "pending") {
        if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
          state = "idle";
          return;
        }
        if (dx < SLOP || dx < Math.abs(dy) * 1.5) return;
        state = "drag";
        top()?.classList.add("is-dragging");
        cb.current.onStart();
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (x - lastX) / dt;
      lastX = x;
      lastT = e.timeStamp;
      paint(Math.max(0, dx - SLOP), false);
    };

    const onTouchEnd = () => {
      if (state === "pending") state = "idle";
      if (state !== "drag") return;
      state = "settling";
      const w = root.clientWidth;
      const dx = lastX - startX - SLOP;
      const commit = dx > w / 3 || (velocity > 0.5 && dx > 30);
      paint(commit ? w : 0, true);
      window.setTimeout(() => {
        state = "idle";
        if (commit) cb.current.onCommit();
        else {
          reset();
          cb.current.onCancel();
        }
      }, SETTLE_MS);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [stack, enabled]);
}
