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
import { initMlId } from "./lib/mlid";
import { initMlNhentai } from "./lib/mlNhentai";
import { initCloud } from "./lib/cloudSync";
import { initTabBinding } from "./browser/tabBinding";

// MoeLibre ID: возврат из браузера после входа и профиль — до первой отрисовки
initMlId();
// Аккаунт nhentai из привязки MoeLibre: вход на новом устройстве и общие токены
initMlNhentai();
// Облако MoeLibre (по умолчанию выключено; подключается, пока вошли в MoeLibre ID)
initCloud();
// У каждой вкладки свой аккаунт nhentai и свои фильтры каталога
initTabBinding();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
