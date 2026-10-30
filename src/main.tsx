import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Шрифт MedeoSans (пакет medeo-font): обычный CSS с @font-face — вариант для Next.js здесь не подходит.
import "medeo-font/sans.css";
// Стили кита раньше стилей экранов: экраны дополняют и переопределяют кит.
import "./ui/ui.css";
import "./styles.css";
import "./ui/kit.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
