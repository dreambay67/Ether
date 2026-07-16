import { describe, expect, it } from "vitest";

import { discoverCodexCli, runCli } from "../cliConformance.js";

describe("Codex CLI discovery conformance", () => {
  it("discovers a compatible no-auth command surface", () => {
    const cli = discoverCodexCli();

    try {
      const version = runCli(cli.executable, ["--version"]);
      const help = runCli(cli.executable, ["--help"]);

      expect(version.status, version.output).toBe(0);
      expect(version.output).toMatch(/^codex-cli \d+\.\d+\.\d+/m);
      expect(help.status, help.output).toBe(0);
      expect(help.output).toContain("exec");
      expect(help.output).toContain("app-server");
    } finally {
      cli.cleanup();
    }
  });
});
