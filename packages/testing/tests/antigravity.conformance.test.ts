import { describe, expect, it } from "vitest";

import { discoverAntigravityCli, runCli } from "../cliConformance.js";

describe("Antigravity CLI discovery conformance", () => {
  it("discovers the compatible no-auth image command surface", () => {
    const cli = discoverAntigravityCli();

    try {
      const version = runCli(cli.executable, ["--version"]);
      const help = runCli(cli.executable, ["help"]);

      expect(version.status, version.output).toBe(0);
      expect(version.output).toMatch(/^\d+\.\d+\.\d+$/m);
      expect(help.status, help.output).toBe(0);
      expect(help.output).toContain("--print");
      expect(help.output).toContain("--model");
      expect(help.output).toContain("--add-dir");
      expect(help.output).toContain("--print-timeout");
    } finally {
      cli.cleanup();
    }
  });
});
