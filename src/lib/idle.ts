/** Выполнить, когда главный поток свободен (долгая запись в localStorage не должна попадать на прокрутку). */
export function whenIdle(fn: () => void, timeout = 3000): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout });
  else window.setTimeout(fn, 0);
}
