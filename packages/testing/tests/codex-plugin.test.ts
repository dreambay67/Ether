import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const pluginPackageRoot = path.join(repoRoot, "packages", "codex-plugin");
const pluginRoot = path.join(pluginPackageRoot, "ether");

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

const requiredSkills = [
  "ether-workflow",
  "ether-connection-model",
  "ether-graph-architect",
  "ether-prompt-systems",
  "ether-review-router",
  "ether-artifact-librarian",
  "ether-provider-safety",
  "ether-recovery"
] as const;

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
} satisfies Record<(typeof requiredSkills)[number], RegExp[]>;

const ether25Channels = ["text", "image", "mask", "data", "video", "audio"] as const;
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
] as const;
const promptFamilySubnodes = ["Prompt", "Brainstormer", "Mutator", "Expander", "Reinforcer"] as const;
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

function skillPath(skillName: string) {
  return path.join(pluginRoot, "skills", skillName, "SKILL.md");
}

async function readSkill(skillName: string) {
  return readFile(skillPath(skillName), "utf8");
}

function parseFrontmatter(skill: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill);
  expect(match, "skill must start with YAML frontmatter").not.toBeNull();

  const frontmatter = Object.fromEntries(
    match![1]
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const separator = line.indexOf(":");
        expect(separator, `invalid frontmatter line: ${line}`).toBeGreaterThan(0);
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  ) as Record<string, string>;

  return frontmatter;
}

function expectSemanticFrontmatter(skillName: (typeof requiredSkills)[number], description: string) {
  expect(description).toMatch(/^Use when\b/);

  for (const trigger of skillTriggerTerms[skillName]) {
    expect(description).toMatch(trigger);
  }

  for (const forbidden of summaryFrontmatterTerms) {
    expect(description).not.toMatch(forbidden);
  }
}

function expectSharedSafetyRules(skill: string) {
  expect(skill).toMatch(/inspect the current ether graph before/i);
  expect(skill).toMatch(/project-local/i);
  expect(skill).toMatch(/silent\s+(?:generation|execution|runs?)/i);
  expect(skill).toMatch(/do not run[\s\S]*unless the user explicitly asks/i);
}

function expectEther25Model(content: string) {
  expect(content).toContain(`Channels: ${ether25Channels.join(", ")}`);
  expect(content).toContain(`Roles: ${ether25Roles.join(", ")}`);
  expect(content).toContain(`Prompt family: ${promptFamilySubnodes.join(", ")}`);
  expect(content).toMatch(/one Prompt family/i);
  expect(content).toMatch(/15 roles/i);
  expect(content).toMatch(/six channels/i);
  expect(content).toMatch(/connection role grid/i);

  for (const forbidden of retiredModelLanguage) {
    expect(content).not.toMatch(forbidden);
  }
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

  it("advertises Ether 2.5 node-role-channel and multimodal media capabilities", async () => {
    const manifest = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
    const pluginInterface = manifest.interface as Record<string, unknown>;
    const capabilities = pluginInterface.capabilities as string[];
    const advertised = JSON.stringify(pluginInterface);

    expect(capabilities).toEqual(
      expect.arrayContaining(["2.5 Node Role Channel Model", "Multimodal Media Routing"])
    );
    expect(advertised).toContain("ether-connection-model");
    expect(advertised).toContain("2.5 Node Role Channel Model");
    expect(advertised).toContain("Multimodal Media Routing");
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

  it("ships all advanced Ether skills with valid frontmatter and shared execution safety rules", async () => {
    for (const skillName of requiredSkills) {
      const skill = await readSkill(skillName);
      const frontmatter = parseFrontmatter(skill);

      expect(frontmatter.name).toBe(skillName);
      expect(frontmatter.description).toBeTruthy();
      expectSemanticFrontmatter(skillName, frontmatter.description);
      expectSharedSafetyRules(skill);
      expectEther25Model(skill);
    }
  });

  it("ships focused OpenAI skill cards for every Ether skill", async () => {
    for (const skillName of requiredSkills) {
      const skillUi = await readFile(path.join(pluginRoot, "skills", skillName, "agents", "openai.yaml"), "utf8");

      expect(skillUi).toContain(`Use $${skillName}`);
      expect(skillUi).toContain("Ether 2.5");
    }
  });

  it("keeps artifact guidance project-local without browser or desktop automation wording", async () => {
    const workflow = await readSkill("ether-workflow");
    const artifact = await readSkill("ether-artifact-librarian");
    const recipes = await readFile(
      path.join(pluginRoot, "skills", "ether-workflow", "recipes", "advanced-workflows.md"),
      "utf8"
    );

    for (const content of [workflow, artifact, recipes]) {
      expect(content).not.toMatch(/browser\s+(?:drag|intake)/i);
    }

    expect(workflow).toMatch(/Do not use browser or desktop automation to operate Ether or simulate drag\/drop/i);
    expect(artifact).toMatch(/Do not use browser or desktop automation to operate Ether or simulate drag\/drop/i);
    expect(artifact).toMatch(/user-provided dropped assets/i);
    expect(recipes).toMatch(/user-provided dropped assets/i);
    expect(recipes).toMatch(/MCP\/project-local files/i);
  });

  it("advertises advanced Ether skill capabilities in the plugin manifest", async () => {
    const manifest = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
    const pluginInterface = manifest.interface as Record<string, unknown>;
    const capabilities = pluginInterface.capabilities as string[];
    const advertised = JSON.stringify(pluginInterface);

    expect(capabilities).toEqual(
      expect.arrayContaining([
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
      ])
    );

    for (const skillName of requiredSkills.slice(1)) {
      expect(advertised).toContain(skillName);
    }
  });

  it("routes the main Ether workflow skill to each focused advanced skill", async () => {
    const workflow = await readSkill("ether-workflow");

    for (const skillName of requiredSkills.slice(1)) {
      expect(workflow).toContain(`$${skillName}`);
    }

    expect(workflow).toContain("preview graph patches");
    expect(workflow).toContain("preview run plans");
    expect(workflow).toContain("explicit execution only");
    expect(workflow).toContain("$ether-connection-model");
  });

  it("documents advanced workflow recipes for high-level Ether workflow building", async () => {
    const recipes = await readFile(
      path.join(pluginRoot, "skills", "ether-workflow", "recipes", "advanced-workflows.md"),
      "utf8"
    );
    const normalized = recipes.toLowerCase();

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
      expect(normalized).toContain(phrase);
    }
  });

  it("explains every provider safety mode and bans hidden provider fallback", async () => {
    const skill = await readSkill("ether-provider-safety");

    for (const mode of ["CLI mode", "MCP mode", "API mode", "Simulation mode", "Experimental mode"]) {
      expect(skill).toContain(mode);
    }

    expect(skill).toContain("CLI Codex is the default provider");
    expect(skill).toContain("No hidden API fallback");
    expect(skill).toContain("Do not use browser or desktop automation");
  });
});
