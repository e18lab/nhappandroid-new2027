/**
 * Обработчик с постоянной ссылкой, который всегда вызывает свежую версию функции. Нужен, чтобы
 * карточки в memo не перерисовывались из-за нового `onPress` на каждой отрисовке списка.
 */
import { useCallback, useLayoutEffect, useRef } from "react";

export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
