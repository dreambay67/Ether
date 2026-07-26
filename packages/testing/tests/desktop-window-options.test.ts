import path from "node:path";
import { describe, expect, it } from "vitest";
import {
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

  it("maximizes the first window before showing it", () => {
    const calls: string[] = [];
    showMainWindowMaximized({
      isDestroyed: () => false,
      maximize: () => calls.push("maximize"),
      show: () => calls.push("show")
    });

    expect(calls).toEqual(["maximize", "show"]);
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
