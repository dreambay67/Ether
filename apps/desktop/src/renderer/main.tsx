import React from "react";
import { createRoot } from "react-dom/client";
import "@ether/brand/brand.css";
import "./styles.css";
import { App } from "./App";
import { markPerformance } from "./performance/marks";

markPerformance("cold-start:start");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Ether renderer root element #root was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
