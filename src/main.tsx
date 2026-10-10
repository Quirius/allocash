import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/app.css";
import "./styles/ynab-theme.css";
import "./styles/plan-ynab.css";
import "./styles/transaction-inline.css";
import "./styles/transaction-menu.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
