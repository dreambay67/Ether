import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "ether");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const skillPath = path.join(pluginRoot, "skills", "ether-workflow", "SKILL.md");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function assertFile(filePath) {
  const entry = await stat(filePath);

  if (!entry.isFile()) {
    throw new Error(`Expected file: ${filePath}`);
  }
}

const manifest = await readJson(manifestPath);
const mcp = await readJson(mcpPath);
const skill = await readFile(skillPath, "utf8");

await assertFile(manifestPath);
await assertFile(mcpPath);
await assertFile(skillPath);

if (manifest.name !== "ether" || manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") {
  throw new Error("Ether plugin manifest is missing required identity, skills, or MCP fields.");
}

if (JSON.stringify(manifest).includes("[TODO:")) {
  throw new Error("Ether plugin manifest contains TODO placeholders.");
}

if (!mcp.mcpServers?.ether?.args?.includes("../../mcp-server/dist/index.js")) {
  throw new Error("Ether MCP registration must point to ../../mcp-server/dist/index.js.");
}

if (!skill.includes("only run nodes after the user explicitly asks")) {
  throw new Error("Ether workflow skill must enforce explicit execution.");
}

process.stdout.write("Ether Codex plugin validation passed.\n");
