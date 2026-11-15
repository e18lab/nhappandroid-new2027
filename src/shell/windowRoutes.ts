/**
 * Страницы-«окна»: на широком экране (от 720px) настройки, профили, аккаунт MoeLibre ID и выбор тегов открываются окном
 * поверх текущего экрана (Shell.tsx). Адресная строка ПК при этом показывает адрес экрана под окном.
 */

/** С какой ширины окна страницы-«окна» открываются поверх экрана, а не на весь экран. */
export const WIDE_QUERY = "(min-width: 720px)";

export function isWindowRoute(pathname: string): boolean {
  return /^\/(settings|profile|tags|mlid|accounts|tabs)(\/|$)/.test(pathname);
}
