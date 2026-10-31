/**
 * Старый адрес вкладки «Профиль» (`/me`). Отдельного экрана больше нет: после входа — своя страница профиля,
 * гостю — окно входа поверх главной. Кнопки профиля открывают их сами, сюда попадают только по старой ссылке.
 */
import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { ownProfileRoute, useMe } from "../lib/session";
import { openLogin } from "../shell/LoginModal";

export function MeScreen() {
  const own = ownProfileRoute(useMe());
  useEffect(() => {
    if (!own) openLogin();
  }, [own]);
  return <Navigate to={own || "/"} replace />;
}
