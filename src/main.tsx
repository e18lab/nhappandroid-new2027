// Демо-аккаунт для скриншотов (только dev, `?demo`) — раньше всех модулей, читающих вход
import "./dev/demo";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Класс is-desktop у <html> — до первой отрисовки
import "./lib/platform";
// Шрифт MedeoSans (пакет medeo-font): обычный CSS с @font-face — вариант для Next.js здесь не подходит.
import "medeo-font/sans.css";
// Стили кита раньше стилей экранов: экраны дополняют и переопределяют кит.
import "./ui/ui.css";
import "./styles.css";
import "./ui/kit.css";
import "./ui/refresh.css";
import { initMlId } from "./lib/mlid";
import { initMlNhentai } from "./lib/mlNhentai";
import { initCloud } from "./lib/cloudSync";
import { initTabBinding } from "./browser/tabBinding";
import { installTooltips } from "./ui/tooltip";

// Системное меню WebView («Назад», «Печать», «Сохранить как»…) не показываем нигде: у карточек тайтлов,
// вкладок и т. п. своё. Оставлено только в полях ввода (вставить, вырезать) — и всё, что открыло своё
// меню, уже вызвало preventDefault.
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest?.("input, textarea, [contenteditable]:not([contenteditable='false'])")) return;
  e.preventDefault();
});

// MoeLibre ID: возврат из браузера после входа и профиль — до первой отрисовки
initMlId();
// Аккаунт nhentai из привязки MoeLibre: вход на новом устройстве и общие токены
initMlNhentai();
// Отладка: мост к MCP-серверу tools/app-mcp (только в разработке, в сборку не попадает)
if (import.meta.env.DEV) void import("./dev/appBridge").then((m) => m.startAppBridge());
// Облако MoeLibre (по умолчанию выключено; подключается, пока вошли в MoeLibre ID)
initCloud();
// У каждой вкладки свой аккаунт nhentai и свои фильтры каталога
initTabBinding();
// Подсказки кита вместо системных — у всех элементов с title
installTooltips();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
