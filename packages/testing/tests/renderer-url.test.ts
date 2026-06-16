import { describe, expect, it } from "vitest";
import { isLocalDevelopmentRendererUrl } from "../../../apps/desktop/src/main/rendererUrl";

describe("development renderer URL policy", () => {
  it("allows only local renderer URLs in development", () => {
    expect(isLocalDevelopmentRendererUrl("http://127.0.0.1:5173", true)).toBe(true);
    expect(isLocalDevelopmentRendererUrl("http://localhost:5173", true)).toBe(true);
    expect(isLocalDevelopmentRendererUrl("http://[::1]:5173", true)).toBe(true);
  });

  it("rejects remote, invalid, and production renderer URLs", () => {
    expect(isLocalDevelopmentRendererUrl("https://example.com", true)).toBe(false);
    expect(isLocalDevelopmentRendererUrl("file:///tmp/index.html", true)).toBe(false);
    expect(isLocalDevelopmentRendererUrl("not a url", true)).toBe(false);
    expect(isLocalDevelopmentRendererUrl("http://127.0.0.1:5173", false)).toBe(false);
  });
});
