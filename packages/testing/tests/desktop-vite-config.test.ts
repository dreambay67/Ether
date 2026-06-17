import { describe, expect, it } from "vitest";
import desktopViteConfig from "../../../apps/desktop/vite.config";

describe("desktop Vite packaging config", () => {
  it("uses relative asset paths so the Electron package can load from file URLs", () => {
    expect(desktopViteConfig).toMatchObject({
      base: "./"
    });
  });
});
