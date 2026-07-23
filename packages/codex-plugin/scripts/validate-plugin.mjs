import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "ether");
const skillsRoot = path.join(pluginRoot, "skills");
const primarySkills = [
  "ether-director",
  "ether-graph-architect",
  "ether-intelligence-director",
  "ether-reference-curator",
  "ether-run-operator",
  "ether-recipe-studio",
  "ether-review-director",
  "ether-artifact-librarian",
  "ether-project-doctor"
];
const compatibilitySkills = [
  "ether-workflow",
  "ether-connection-model",
  "ether-prompt-systems",
  "ether-review-router",
  "ether-provider-safety",
  "ether-recovery"
];
const allSkills = [...primarySkills, ...compatibilitySkills];
const channels = ["text", "image", "mask", "data", "video", "audio"];
const roles = ["general", "negative", "subject", "product", "face", "clothing", "pose", "setting", "composition", "style", "lighting", "colourPalette", "typography", "motion", "timing"];
const publicTools = [
  "ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect",
  "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate",
  "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject",
  "ether.provider.inspect", "ether.recipe.list", "ether.recipe.setup", "ether.recipe.preview", "ether.recipe.instantiate",
  "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list",
  "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start", "ether.run.cancel", "ether.run.retry"
];
const skillTools = {
  "ether-director": ["ether.document.inspect", "ether.document.health", "ether.recovery.inspect", "ether.permission.inspect", "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.provider.inspect", "ether.recipe.list", "ether.recipe.setup", "ether.recipe.preview", "ether.recipe.instantiate", "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list", "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start"],
  "ether-graph-architect": ["ether.document.inspect", "ether.permission.inspect", "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.project.doctor"],
  "ether-intelligence-director": ["ether.document.inspect", "ether.permission.inspect", "ether.node.catalog", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.provider.inspect", "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.lineage", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start"],
  "ether-reference-curator": ["ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.provider.inspect", "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage"],
  "ether-run-operator": ["ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect", "ether.graph.inspect", "ether.graph.validate", "ether.provider.inspect", "ether.reference.list", "ether.artifact.search", "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start", "ether.run.cancel", "ether.run.retry"],
  "ether-recipe-studio": ["ether.document.inspect", "ether.project.doctor", "ether.permission.inspect", "ether.node.catalog", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.provider.inspect", "ether.recipe.list", "ether.recipe.setup", "ether.recipe.preview", "ether.recipe.instantiate", "ether.run.plan.preview", "ether.run.start"],
  "ether-review-director": ["ether.document.inspect", "ether.project.doctor", "ether.permission.inspect", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list", "ether.run.inspect"],
  "ether-artifact-librarian": ["ether.document.inspect", "ether.permission.inspect", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list"],
  "ether-project-doctor": ["ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect", "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate", "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject", "ether.provider.inspect", "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start"]
};
const retiredPatterns = [
  /Ether 2\.5/i,
  /folder projects?/i,
  /Assistant family/i,
  /prompt[- ]section nodes?/i,
  /hidden (?:run|fallback)/i,
  /ether_graph_save/i,
  /ether_run_selected/i,
  /project\.json/i,
  /graph\.json/i,
  /ether\.db/i,
  /permission\.grant(?:Edit|Run)/i,
  /`(?:document|graph|recipe|reference|artifact|collection|provider|permission|project|recovery|node|run)\.[^`]+`/i
];
const concreteTempReference = /^\$temp:(graph|node|edge|group|module):[A-Za-z0-9][A-Za-z0-9._-]*$/;
const documentedTempGrammar = new Set(["$temp:<kind>:<name>", "$temp:<graph|node|edge|group|module>:<name>"]);
const documentedTypedTemp = /^\$temp:(graph|node|edge|group|module):<name>$/;

function fail(message) {
  throw new Error(`Ether 4.0 plugin validation: ${message}`);
}

async function text(filePath) {
  const entry = await stat(filePath).catch(() => null);
  if (entry === null || !entry.isFile()) fail(`missing file ${filePath}`);
  return readFile(filePath, "utf8");
}

function exactKeys(value, expected, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} keys must be exactly ${wanted.join(", ")}`);
}

function parseFrontmatter(content, name) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) fail(`${name} lacks YAML frontmatter`);
  const fields = Object.fromEntries(match[1].split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf(":");
    if (index < 1) fail(`${name} has invalid frontmatter`);
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
  exactKeys(fields, ["name", "description"], `${name} frontmatter`);
  if (fields.name !== name || !fields.description.startsWith("Use when")) fail(`${name} has invalid name or description`);
}

function validateAgentYaml(content, skillName) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length !== 4 || lines[0] !== "interface:") fail(`${skillName} agent YAML must contain one interface mapping`);
  const fields = Object.fromEntries(lines.slice(1).map((line) => {
    const match = /^ {2}(display_name|short_description|default_prompt):\s+(.+)$/.exec(line);
    if (match === null) fail(`${skillName} agent YAML has an invalid field`);
    return [match[1], match[2]];
  }));
  exactKeys(fields, ["display_name", "short_description", "default_prompt"], `${skillName} agent interface`);
  if (!fields.default_prompt.includes(`Use $${skillName}`) || !fields.default_prompt.includes("Ether 4.0")) fail(`${skillName} agent default prompt is invalid`);
}

function validateLanguage(content, label) {
  for (const pattern of retiredPatterns) if (pattern.test(content)) fail(`${label} contains forbidden language matching ${pattern}`);
  const namedTools = [...content.matchAll(/`(ether\.[a-z.]+)`/g)].map((match) => match[1]);
  for (const tool of namedTools) if (!publicTools.includes(tool)) fail(`${label} names nonexistent tool ${tool}`);
  const dollarTokens = content.match(/\$[A-Za-z][A-Za-z0-9:._<>|/-]*/g) ?? [];
  for (const token of dollarTokens) {
    if (token.startsWith("$ether-")) continue;
    if (documentedTempGrammar.has(token) || documentedTypedTemp.test(token) || concreteTempReference.test(token)) continue;
    fail(`${label} contains invalid temporary or skill reference ${token}`);
  }
}

function validateTransactionReferences(value, label) {
  const placeholders = [];
  const visit = (item) => {
    if (typeof item === "string" && item.startsWith("$")) {
      if (!concreteTempReference.test(item)) fail(`${label} contains invalid temporary reference ${item}`);
    } else if (typeof item === "string" && item.includes("{{")) {
      if (!/^\{\{[A-Za-z][A-Za-z0-9]*\}\}$/.test(item)) fail(`${label} contains invalid template placeholder ${item}`);
      placeholders.push(item);
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (typeof item === "object" && item !== null) {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return placeholders;
}

const manifest = JSON.parse(await text(path.join(pluginRoot, ".codex-plugin", "plugin.json")));
exactKeys(manifest, ["name", "version", "description", "author", "license", "keywords", "skills", "mcpServers", "interface"], "plugin manifest");
if (manifest.name !== "ether" || manifest.version !== "4.0.0" || manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") fail("manifest identity is invalid");
exactKeys(manifest.author, ["name", "email"], "manifest author");
const highlights = manifest.interface?.skillHighlights;
if (!Array.isArray(highlights) || highlights.length !== primarySkills.length) fail("manifest must advertise exactly nine skill highlights");
const highlightedNames = highlights.map((item) => item?.skill).sort();
if (JSON.stringify(highlightedNames) !== JSON.stringify([...primarySkills].sort())) fail("manifest skill highlights do not match primary skills");
for (const item of highlights) exactKeys(item, ["skill", "capability", "useWhen"], `manifest highlight ${item.skill ?? "unknown"}`);

const mcp = JSON.parse(await text(path.join(pluginRoot, ".mcp.json")));
exactKeys(mcp, ["mcpServers"], "MCP config");
exactKeys(mcp.mcpServers, ["ether"], "MCP servers");
const etherServer = mcp.mcpServers.ether;
exactKeys(etherServer, ["command", "args", "env"], "Ether MCP server");
if (etherServer.command !== "node" || JSON.stringify(etherServer.args) !== JSON.stringify(["../../mcp-server/dist/index.js"])) fail("Ether MCP command or args are invalid");
if (JSON.stringify(etherServer.env) !== "{}") fail("Ether MCP env must be empty and secret-free");

const directories = (await readdir(skillsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
if (JSON.stringify(directories) !== JSON.stringify([...allSkills].sort())) fail("skills directory must contain exactly nine primary skills and six compatibility aliases");

for (const skillName of primarySkills) {
  const skill = await text(path.join(skillsRoot, skillName, "SKILL.md"));
  const card = await text(path.join(skillsRoot, skillName, "agents", "openai.yaml"));
  parseFrontmatter(skill, skillName);
  validateAgentYaml(card, skillName);
  validateLanguage(skill, skillName);
  validateLanguage(card, `${skillName} agent card`);
  if (!skill.includes(`Channels: ${channels.join(", ")}`) || !skill.includes(`Roles: ${roles.join(", ")}`)) fail(`${skillName} must state the exact six channels and fifteen roles`);
  for (const tool of skillTools[skillName]) if (!skill.includes(`\`${tool}\``)) fail(`${skillName} must name ${tool}`);
  if (!/host-issued|issued by the Ether host/i.test(skill) || !/MCP cannot (?:create|grant)/i.test(skill)) fail(`${skillName} must explain host-issued permits without self-escalation`);
}

for (const skillName of compatibilitySkills) {
  const skill = await text(path.join(skillsRoot, skillName, "SKILL.md"));
  parseFrontmatter(skill, skillName);
  validateLanguage(skill, skillName);
  if (!/Compatibility alias/i.test(skill) || !/\$ether-/.test(skill) || skill.split(/\r?\n/).length > 12) fail(`${skillName} must be a concise compatibility alias`);
}

for (const fileName of ["editorial-campaign.transaction.json", "review-repair.transaction.json"]) {
  const transaction = JSON.parse(await text(path.join(pluginRoot, "examples", fileName)));
  const placeholders = [...new Set(validateTransactionReferences(transaction, fileName))].sort();
  if (!Array.isArray(transaction.operations) || transaction.operations.length === 0 || transaction.actor !== "codex") fail(`${fileName} is not an operational transaction`);
  const expectedPlaceholders = fileName === "review-repair.transaction.json"
    ? ["{{baseDocumentRevisionId}}", "{{baseGraphRevisionId}}", "{{collectionNodeId}}", "{{reviewCollectionEdgeId}}", "{{reviewNodeId}}", "{{targetGraphId}}"].sort()
    : ["{{baseDocumentRevisionId}}", "{{baseGraphRevisionId}}", "{{compositionReferenceId}}", "{{pathGrantId}}", "{{productReferenceId}}", "{{styleReferenceId}}", "{{targetGraphId}}"].sort();
  if (JSON.stringify(placeholders) !== JSON.stringify(expectedPlaceholders)) fail(`${fileName} has an unexpected placeholder contract`);
}

validateLanguage(await text(path.join(root, "INSTALL.md")), "INSTALL.md");
process.stdout.write("Ether 4.0 Codex plugin validation passed.\n");
