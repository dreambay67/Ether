import React from "react";
import { createRoot } from "react-dom/client";
import "@ether/brand/brand.css";
import "./styles.css";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Ether renderer root element #root was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
