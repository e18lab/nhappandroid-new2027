/**
 * Подсказки в стиле кита вместо системных: у любого элемента с `title` (или `data-tip`) при наведении мышью.
 * `title` при первом наведении переносится в `data-tip` — системная подсказка не всплывает; поменял React
 * `title` (закладка добавлена…) — при следующем наведении текст обновится. У значков без подписи текст
 * подсказки становится `aria-label`, чтобы экранные дикторы не потеряли название.
 * Первая подсказка — с задержкой, следующие (ведём мышь по ряду кнопок) — сразу. Касания пальцем не трогает.
 */

const DELAY = 450;
/** Сколько после скрытия подсказки следующая показывается без задержки. */
const WARM_MS = 400;
const GAP = 8;
const EDGE = 6;

declare global {
  interface Window {
    __uiTips?: boolean;
  }
}

export function installTooltips(): void {
  // Флаг на окне, а не в модуле: при горячей перезагрузке модуль грузится заново, а слушатели остаются
  if (typeof document === "undefined" || window.__uiTips) return;
  window.__uiTips = true;

  const tip = document.createElement("div");
  tip.className = "ui-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let current: HTMLElement | null = null;
  let timer = 0;
  let hiddenAt = 0;
  let visible = false;

  const adopt = (el: HTMLElement): string => {
    const title = el.getAttribute("title");
    if (title != null) {
      el.removeAttribute("title");
      el.dataset.tip = title;
      if (title && !el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
    }
    return el.dataset.tip ?? "";
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Снизу от элемента; не помещается — сверху
    const below = r.bottom + GAP + h <= window.innerHeight - EDGE;
    const top = below ? r.bottom + GAP : r.top - GAP - h;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tip.dataset.side = below ? "bottom" : "top";
  };

  const show = (el: HTMLElement) => {
    const text = adopt(el);
    if (!text || !el.isConnected) return;
    tip.textContent = text;
    tip.classList.remove("is-on");
    place(el);
    // Кадр — чтобы анимация появления начиналась с нового места
    requestAnimationFrame(() => tip.classList.add("is-on"));
    visible = true;
  };

  const hide = () => {
    window.clearTimeout(timer);
    if (visible) hiddenAt = Date.now();
    visible = false;
    current = null;
    tip.classList.remove("is-on");
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title], [data-tip]") ?? null;
      if (el === current) return;
      // Текст забираем сразу: иначе системная подсказка успеет всплыть
      if (el) adopt(el);
      const warm = visible || Date.now() - hiddenAt < WARM_MS;
      hide();
      if (!el || !el.dataset.tip) return;
      current = el;
      if (warm) show(el);
      else timer = window.setTimeout(() => current === el && show(el), DELAY);
    },
    true,
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (!to || !current.contains(to)) hide();
    },
    true,
  );
  for (const type of ["pointerdown", "wheel", "keydown", "scroll"]) document.addEventListener(type, hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);
}
