import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const pluginPackageRoot = path.join(repoRoot, "packages", "codex-plugin");
const pluginRoot = path.join(pluginPackageRoot, "ether");

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

describe("Ether Codex plugin package", () => {
  it("ships an installable plugin manifest with skills and MCP registration", async () => {
    const manifest = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
    const mcpConfig = await readJson(path.join(pluginRoot, ".mcp.json"));

    expect(manifest).toMatchObject({
      name: "ether",
      version: "0.1.0",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      interface: expect.objectContaining({
        displayName: "Ether",
        shortDescription: expect.stringContaining("node canvas"),
        brandColor: "#1470DB"
      })
    });
    expect(JSON.stringify(manifest)).not.toContain("[TODO:");
    expect(mcpConfig).toMatchObject({
      mcpServers: {
        ether: expect.objectContaining({
          command: "node",
          args: expect.arrayContaining(["../../mcp-server/dist/index.js"])
        })
      }
    });
  });

  it("includes concise Ether workflow skills that enforce inspect-first execution", async () => {
    const skill = await readFile(path.join(pluginRoot, "skills", "ether-workflow", "SKILL.md"), "utf8");
    const skillUi = await readFile(
      path.join(pluginRoot, "skills", "ether-workflow", "agents", "openai.yaml"),
      "utf8"
    );
    const install = await readFile(path.join(pluginPackageRoot, "INSTALL.md"), "utf8");

    expect(skill).toContain("name: ether-workflow");
    expect(skill).toContain("inspect the graph before execution");
    expect(skill).toContain("only run nodes after the user explicitly asks");
    expect(skill).toContain("ether_node_create");
    expect(skill).toContain("ether_run_selected");
    expect(skillUi).toContain("Use $ether-workflow");
    expect(install).toContain("pnpm --filter @ether/mcp-server build");
    expect(install).toContain("packages/codex-plugin/ether");
  });
});
