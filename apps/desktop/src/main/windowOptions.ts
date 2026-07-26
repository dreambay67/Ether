import path from "node:path";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

type LaunchWindow = Pick<BrowserWindow, "isDestroyed" | "maximize" | "show">;

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: "Ether",
    backgroundColor: "#070B12",
    webPreferences: {
      preload: path.resolve(preloadPath),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  };
}

export function showMainWindowMaximized(window: LaunchWindow): void {
  if (window.isDestroyed()) return;
  window.maximize();
  window.show();
}
