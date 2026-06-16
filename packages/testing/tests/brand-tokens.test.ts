import { describe, expect, it } from "vitest";
import { brandTokens } from "@ether/brand";

describe("brand tokens", () => {
  it("exports Ether electric blue", () => {
    expect(brandTokens.colors.electricBlue).toBe("#1470DB");
  });
});
