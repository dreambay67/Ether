import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMainWindowOptions } from "../../../apps/desktop/src/main/windowOptions";

describe("desktop BrowserWindow options", () => {
  it("loads the local preload bridge without renderer Node access", () => {
    const options = createMainWindowOptions("dist-electron/preload/preload.js");

    expect(options.webPreferences).toMatchObject({
      preload: path.resolve("dist-electron/preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    });
  });
});
