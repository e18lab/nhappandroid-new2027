import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Стили кита раньше стилей экранов: экраны дополняют и переопределяют кит.
import "./ui/ui.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
