import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "ether");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const recipesPath = path.join(pluginRoot, "skills", "ether-workflow", "recipes", "advanced-workflows.md");

const requiredSkills = [
  "ether-workflow",
  "ether-connection-model",
  "ether-graph-architect",
  "ether-prompt-systems",
  "ether-review-router",
  "ether-artifact-librarian",
  "ether-provider-safety",
  "ether-recovery"
];

const requiredCapabilities = [
  "Interactive",
  "Write",
  "2.5 Node Role Channel Model",
  "Multimodal Media Routing",
  "Advanced Graph Architecture",
  "Prompt Systems",
  "Review Routing",
  "Artifact Organization",
  "Provider Safety",
  "Recovery"
];

const skillTriggerTerms = {
  "ether-workflow": [/graph inspection/i, /workflow editing/i, /run-plan preview/i],
  "ether-connection-model": [/node role channel model/i, /connection role grid/i, /multimodal media routing/i],
  "ether-graph-architect": [/graph topology/i, /node role channel model/i, /graph patch preview/i, /run preview/i],
  "ether-prompt-systems": [/Prompt family/i, /connection roles/i, /variant strategy/i],
  "ether-review-router": [/Compare/i, /Evaluation/i, /Filter/i, /Data outputs/i, /audit trails/i],
  "ether-artifact-librarian": [
    /six-channel asset/i,
    /link/i,
    /move/i,
    /copy/i,
    /collections/i,
    /lineage/i,
    /metadata/i,
    /user-provided dropped assets/i
  ],
  "ether-provider-safety": [/CLI/i, /MCP/i, /API/i, /Simulation/i, /Experimental/i, /channel\/operation capabilities/i],
  "ether-recovery": [/health checks/i, /2\.5 migration/i, /missing linked file/i, /orphan artifact/i, /provider log/i]
};

const ether25Channels = ["text", "image", "mask", "data", "video", "audio"];
const ether25Roles = [
  "general",
  "negative",
  "subject",
  "product",
  "face",
  "clothing",
  "pose",
  "setting",
  "composition",
  "style",
  "lighting",
  "colourPalette",
  "typography",
  "motion",
  "timing"
];
const promptFamilySubnodes = ["Prompt", "Brainstormer", "Mutator", "Expander", "Reinforcer"];
const retiredModelLanguage = [
  /Subject Prompt/i,
  /Lighting Prompt/i,
  /Prompt Section/i,
  /Assistant family/i,
  /typed ports?/i,
  /prompt chains/i
];

const summaryFrontmatterTerms = [
  /this skill/i,
  /this workflow/i,
  /\bprovides\b/i,
  /\bguides\b/i,
  /\bteaches\b/i,
  /\bsteps\b/i,
  /\boverview\b/i,
  /\bsummary\b/i
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function assertFile(filePath) {
  const entry = await stat(filePath);

  if (!entry.isFile()) {
    throw new Error(`Expected file: ${filePath}`);
  }
}

function skillPath(skillName) {
  return path.join(pluginRoot, "skills", skillName, "SKILL.md");
}

function skillAgentPath(skillName) {
  return path.join(pluginRoot, "skills", skillName, "agents", "openai.yaml");
}

function parseFrontmatter(skill, skillName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill);

  if (!match) {
    throw new Error(`${skillName} must start with YAML frontmatter.`);
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const separator = line.indexOf(":");

        if (separator <= 0) {
          throw new Error(`${skillName} has invalid frontmatter line: ${line}`);
        }

        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} must include "${expected}".`);
  }
}

function assertMatches(value, expected, label) {
  if (!expected.test(value)) {
    throw new Error(`${label} must match ${expected}.`);
  }
}

function assertNotMatches(value, expected, label) {
  if (expected.test(value)) {
    throw new Error(`${label} must not match ${expected}.`);
  }
}

function assertSemanticFrontmatter(skillName, description) {
  assertMatches(description, /^Use when\b/, `${skillName} description`);

  for (const trigger of skillTriggerTerms[skillName]) {
    assertMatches(description, trigger, `${skillName} description`);
  }

  for (const forbidden of summaryFrontmatterTerms) {
    assertNotMatches(description, forbidden, `${skillName} description`);
  }
}

function assertSharedSafetyRules(skillName, skill) {
  assertMatches(skill, /inspect the current ether graph before/i, skillName);
  assertMatches(skill, /project-local/i, skillName);
  assertMatches(skill, /silent\s+(?:generation|execution|runs?)/i, skillName);
  assertMatches(skill, /do not run[\s\S]*unless the user explicitly asks/i, skillName);
}

function assertEther25Model(skillName, skill) {
  assertIncludes(skill, `Channels: ${ether25Channels.join(", ")}`, skillName);
  assertIncludes(skill, `Roles: ${ether25Roles.join(", ")}`, skillName);
  assertIncludes(skill, `Prompt family: ${promptFamilySubnodes.join(", ")}`, skillName);
  assertMatches(skill, /one Prompt family/i, skillName);
  assertMatches(skill, /15 roles/i, skillName);
  assertMatches(skill, /six channels/i, skillName);
  assertMatches(skill, /connection role grid/i, skillName);

  for (const forbidden of retiredModelLanguage) {
    assertNotMatches(skill, forbidden, skillName);
  }
}

await assertFile(manifestPath);
await assertFile(mcpPath);

const manifest = await readJson(manifestPath);
const mcp = await readJson(mcpPath);

if (manifest.name !== "ether" || manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") {
  throw new Error("Ether plugin manifest is missing required identity, skills, or MCP fields.");
}

if (JSON.stringify(manifest).includes("[TODO:")) {
  throw new Error("Ether plugin manifest contains TODO placeholders.");
}

if (!mcp.mcpServers?.ether?.args?.includes("../../mcp-server/dist/index.js")) {
  throw new Error("Ether MCP registration must point to ../../mcp-server/dist/index.js.");
}

const capabilities = manifest.interface?.capabilities ?? [];
for (const capability of requiredCapabilities) {
  if (!capabilities.includes(capability)) {
    throw new Error(`Ether plugin manifest must advertise capability "${capability}".`);
  }
}

const advertised = JSON.stringify(manifest.interface ?? {});
for (const skillName of requiredSkills.slice(1)) {
  assertIncludes(advertised, skillName, "Ether plugin manifest");
}

for (const skillName of requiredSkills) {
  const filePath = skillPath(skillName);
  const agentPath = skillAgentPath(skillName);
  await assertFile(filePath);
  await assertFile(agentPath);

  const skill = await readFile(filePath, "utf8");
  const agent = await readFile(agentPath, "utf8");
  const frontmatter = parseFrontmatter(skill, skillName);

  if (frontmatter.name !== skillName || !frontmatter.description) {
    throw new Error(`${skillName} must have name and description frontmatter.`);
  }

  assertSemanticFrontmatter(skillName, frontmatter.description);
  assertSharedSafetyRules(skillName, skill);
  assertEther25Model(skillName, skill);
  assertIncludes(agent, `Use $${skillName}`, `${skillName} OpenAI card`);
  assertIncludes(agent, "Ether 2.5", `${skillName} OpenAI card`);
}

const workflow = await readFile(skillPath("ether-workflow"), "utf8");
assertIncludes(workflow, "only run nodes after the user explicitly asks", "ether-workflow");
assertIncludes(workflow, "ether_node_create", "ether-workflow");
assertIncludes(workflow, "ether_run_selected", "ether-workflow");
assertIncludes(workflow, "preview graph patches", "ether-workflow");
assertIncludes(workflow, "preview run plans", "ether-workflow");
assertIncludes(workflow, "explicit execution only", "ether-workflow");

for (const skillName of requiredSkills.slice(1)) {
  assertIncludes(workflow, `$${skillName}`, "ether-workflow");
}

await assertFile(recipesPath);
const recipes = (await readFile(recipesPath, "utf8")).toLowerCase();
for (const phrase of [
  "style exploration",
  "character consistency",
  "product campaign variants",
  "review funnels",
  "role-based prompt variants",
  "collection routing",
  "graph patch preview",
  "run preview",
  "artifact librarian",
  "provider safety",
  "recovery",
  "multimodal media routing"
]) {
  assertIncludes(recipes, phrase, "advanced workflow recipes");
}

const artifact = await readFile(skillPath("ether-artifact-librarian"), "utf8");
for (const [label, content] of [
  ["ether-workflow", workflow],
  ["ether-artifact-librarian", artifact],
  ["advanced workflow recipes", recipes]
]) {
  assertNotMatches(content, /browser\s+(?:drag|intake)/i, label);
}
assertMatches(workflow, /Do not use browser or desktop automation to operate Ether or simulate drag\/drop/i, "ether-workflow");
assertMatches(
  artifact,
  /Do not use browser or desktop automation to operate Ether or simulate drag\/drop/i,
  "ether-artifact-librarian"
);
assertMatches(artifact, /user-provided dropped assets/i, "ether-artifact-librarian");
assertMatches(recipes, /user-provided dropped assets/i, "advanced workflow recipes");
assertMatches(recipes, /MCP\/project-local files/i, "advanced workflow recipes");

const providerSafety = await readFile(skillPath("ether-provider-safety"), "utf8");
for (const mode of ["CLI mode", "MCP mode", "API mode", "Simulation mode", "Experimental mode"]) {
  assertIncludes(providerSafety, mode, "ether-provider-safety");
}
assertMatches(providerSafety, /CLI Codex is the default provider/i, "ether-provider-safety");
assertMatches(providerSafety, /No hidden API fallback/i, "ether-provider-safety");
assertMatches(providerSafety, /Do not use browser or desktop automation/i, "ether-provider-safety");

process.stdout.write("Ether Codex plugin validation passed.\n");
