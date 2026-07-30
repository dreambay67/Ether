import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCredentialWindowOptions,
  createMainWindowOptions,
  showMainWindowMaximized
} from "../../../apps/desktop/src/main/windowOptions";

describe("desktop BrowserWindow options", () => {
  it("loads the local preload bridge without renderer Node access", () => {
    const options = createMainWindowOptions("dist-electron/preload/preload.js");

    expect(options.show).toBe(false);
    expect(options.fullscreen).toBeUndefined();
    expect(options.kiosk).toBeUndefined();
    expect(options.frame).toBeUndefined();
    expect(options.webPreferences).toMatchObject({
      preload: path.resolve("dist-electron/preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    });
  });

  it("presents the Chromium surface before maximizing so content tracks the native frame", () => {
    const calls: string[] = [];
    showMainWindowMaximized({
      isDestroyed: () => false,
      maximize: () => calls.push("maximize"),
      show: () => calls.push("show")
    });

    expect(calls).toEqual(["show", "maximize"]);
  });

  it("uses a bounded non-maximizable window for credential-only setup", () => {
    const options = createCredentialWindowOptions("dist-electron/preload/preload.js");
    expect(options).toMatchObject({
      width: 560,
      height: 660,
      minWidth: 500,
      minHeight: 600,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      show: false
    });
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    });
  });

  it("does not present a destroyed launch window", () => {
    const calls: string[] = [];
    showMainWindowMaximized({
      isDestroyed: () => true,
      maximize: () => calls.push("maximize"),
      show: () => calls.push("show")
    });

    expect(calls).toEqual([]);
  });
});
