import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Ether",
    backgroundColor: "#070B12",
    webPreferences: {
      preload: path.resolve(preloadPath),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}
