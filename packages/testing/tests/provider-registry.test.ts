import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliImageProvider,
  FakeImageProvider,
  classifyCodexCliFailure,
  createDefaultProviderRegistry,
  diagnoseProviderRegistry,
  hasBlockedOpenAiEnvKey,
  runProviderProcess,
  sanitizeProviderEnv,
  type GenerationProviderInput,
  type ProviderProcessCall
} from "@ether/providers";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-provider-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function providerInput(projectPath: string): GenerationProviderInput {
  return {
    projectPath,
    runId: "run-1",
    generationNodeId: "generation",
    iteration: 2,
    prompt: "glass bottle under crisp studio light",
    negativePrompt: "no warped labels",
    sections: [
      {
        nodeId: "prompt",
        kind: "prompt",
        section: "General",
        title: "Campaign Prompt",
        text: "glass bottle under crisp studio light"
      }
    ],
    references: [
      {
        nodeId: "reference",
        role: "style",
        title: "Style Reference",
        sourceKind: "Image",
        assetPath: path.join(projectPath, "reference.png")
      }
    ],
    edgeRoles: [{ edgeId: "edge-reference-generation", role: "style" }],
    requestedAt: "2026-06-17T13:00:00.000Z"
  };
}

const pngSignatureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);

describe("generation provider registry", () => {
  it("lists provider capabilities and diagnostics without enabling OpenAI API fallback", async () => {
    const registry = createDefaultProviderRegistry({
      codexCliPath: "C:\\Tools\\codex.exe",
      env: {
        OPENAI_API_KEY: "sk-should-not-enable-platform-api"
      },
      fileExists: async (filePath) => filePath === "C:\\Tools\\codex.exe"
    });

    const providers = registry.listDescriptors();
    const diagnostics = await diagnoseProviderRegistry(registry, {
      env: { OPENAI_API_KEY: "sk-should-not-enable-platform-api" }
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      "ether-fake-local",
      "codex-chatgpt-image-2",
      "google-nano-banana-pro",
      "google-nano-banana-2"
    ]);
    expect(providers.find((provider) => provider.id === "ether-fake-local")?.capabilities).toContain(
      "image.generate"
    );
    expect(diagnostics.policy.openAiPlatformApi).toMatchObject({
      status: "blocked",
      envKeyDetected: true
    });
    expect(diagnostics.providers.find((provider) => provider.id === "codex-chatgpt-image-2")).toMatchObject({
      availability: "available",
      route: "codex-cli"
    });
    expect(diagnostics.providers.find((provider) => provider.id === "google-nano-banana-pro")).toMatchObject({
      availability: "unavailable",
      route: "unconfigured-clean-cli-or-mcp"
    });
  });

  it("detects and strips blocked OpenAI env keys case-insensitively", () => {
    const env = {
      openai_api_key: "sk-lowercase",
      Azure_OpenAI_Endpoint: "https://blocked.example",
      PATH: "C:\\Windows\\System32"
    };

    expect(hasBlockedOpenAiEnvKey(env)).toBe(true);
    expect(sanitizeProviderEnv(env)).toEqual({
      PATH: "C:\\Windows\\System32"
    });
  });

  it("produces deterministic fake image artifacts for offline tests", async () => {
    const projectPath = await createTempRoot();
    const provider = new FakeImageProvider();
    const first = await provider.generate(providerInput(projectPath));
    const second = await provider.generate(providerInput(projectPath));

    expect(first).toEqual(second);
    expect(first.providerId).toBe("ether-fake-local");
    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]).toMatchObject({
      fileName: "fake-output-generation-2.svg",
      mimeType: "image/svg+xml"
    });
    expect(String(first.artifacts[0]?.content)).toContain("ETHER_FAKE_GENERATED_IMAGE");
    expect(String(first.artifacts[0]?.content)).toContain("glass bottle under crisp studio light");
  });

  it("builds a Codex CLI image invocation and withholds OpenAI API keys from the child process", async () => {
    const projectPath = await createTempRoot();
    const referencePath = path.join(projectPath, "reference.png");
    await writeFile(referencePath, "reference");
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      env: {
        openai_api_key: "sk-must-not-leak",
        Azure_OpenAI_Endpoint: "https://blocked.example",
        PATH: "C:\\Windows\\System32"
      },
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        const prompt = call.args.at(-1) ?? "";
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(prompt)?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, validPngBytes);
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "complete",
            image_path: imagePath,
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "{\"ok\":true}", stderr: "", exitCode: 0 };
      }
    });

    const result = await provider.generate(providerInput(projectPath));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("C:\\Tools\\codex.exe");
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--skip-git-repo-check",
        "--cd",
        projectPath,
        "--sandbox",
        "workspace-write",
        "--ephemeral",
        "--ignore-rules",
        "--json",
        "--config",
        "model_reasoning_effort=\"low\"",
        "--image",
        referencePath
      ])
    );
    expect(calls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0]?.env.openai_api_key).toBeUndefined();
    expect(calls[0]?.env.Azure_OpenAI_Endpoint).toBeUndefined();
    expect(calls[0]?.args.join(" ")).not.toContain("sk-must-not-leak");
    expect(calls[0]?.args.at(-1)).toContain("Do not use OPENAI_API_KEY");
    expect(result.artifacts[0]).toMatchObject({
      fileName: "image.png",
      mimeType: "image/png"
    });
    await expect(readFile(result.artifacts[0]!.sourcePath!)).resolves.toEqual(validPngBytes);
  });

  it("prefers the user Codex config binary over an env alias path", async () => {
    const userProfile = await createTempRoot();
    const configDir = path.join(userProfile, ".codex");
    const configuredCodexPath = path.join(userProfile, "OpenAI", "Codex", "codex.exe");
    await mkdir(path.dirname(configuredCodexPath), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(configuredCodexPath, "codex");
    await writeFile(
      path.join(configDir, "config.toml"),
      `CODEX_CLI_PATH = '${configuredCodexPath}'\n`,
      "utf8"
    );
    const provider = new CodexCliImageProvider({
      env: {
        USERPROFILE: userProfile,
        CODEX_CLI_PATH: "C:\\Users\\deny7\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe"
      },
      fileExists: async (filePath) => filePath === configuredCodexPath
    });

    await expect(provider.diagnose()).resolves.toMatchObject({
      availability: "available",
      details: {
        codexCliPath: configuredCodexPath
      }
    });
  });

  it("rejects the WindowsApps Codex alias even when it exists", async () => {
    const projectPath = await createTempRoot();
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliImageProvider({
      env: {
        USERPROFILE: projectPath,
        CODEX_CLI_PATH: "C:\\Users\\deny7\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe"
      },
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.diagnose()).resolves.toMatchObject({
      availability: "unavailable",
      messages: [expect.stringMatching(/WindowsApps.*blocked.*user-local CODEX_CLI_PATH/i)]
    });
    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/WindowsApps.*blocked/i);
    expect(calls).toEqual([]);
  });

  it("rejects Codex worker failure results even when an image file exists", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(call.args.at(-1) ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, "image-bytes");
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "failed",
            image_path: null,
            error: "native image generation unavailable"
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(
      /native image generation unavailable/i
    );
  });

  it("requires the Codex worker result contract to point at image.png", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(call.args.at(-1) ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        const imagePath = path.join(outputDir, "image.webp");
        await writeFile(imagePath, "image-bytes");
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "complete",
            image_path: imagePath,
            error: null
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/image\.png/i);
  });

  it("rejects Codex image.png outputs with a PNG header but corrupt chunk structure", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(call.args.at(-1) ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, Buffer.concat([pngSignatureBytes, Buffer.from("not a real PNG")]));
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "complete",
            image_path: imagePath,
            error: null
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/not valid PNG bytes/i);
  });

  it("reports a useful error when Codex result.json points at a missing image.png", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(call.args.at(-1) ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "complete",
            image_path: path.join(outputDir, "image.png"),
            error: null
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/required PNG output was not found/i);
  });

  it("times out provider child processes with bounded diagnostic output", async () => {
    await expect(
      runProviderProcess(
        {
          command: process.execPath,
          args: ["-e", "process.stdout.write('start-' + 'x'.repeat(10000)); setTimeout(() => {}, 1000);"],
          cwd: process.cwd(),
          env: {}
        },
        {
          timeoutMs: 50,
          outputLimitBytes: 64
        }
      )
    ).rejects.toThrow(/timed out/i);
  });

  it("bounds provider child process stdout and stderr capture", async () => {
    const result = await runProviderProcess(
      {
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('out-' + 'a'.repeat(200)); process.stderr.write('err-' + 'b'.repeat(200));"
        ],
        cwd: process.cwd(),
        env: {}
      },
      {
        timeoutMs: 5000,
        outputLimitBytes: 64
      }
    );

    expect(result.stdout.length).toBeLessThan(180);
    expect(result.stderr.length).toBeLessThan(180);
    expect(result.stdout).toContain("out-");
    expect(result.stdout).toContain("[truncated");
    expect(result.stderr).toContain("err-");
    expect(result.stderr).toContain("[truncated");
  });

  it("classifies Codex local state failures separately from prompt or generation failures", () => {
    expect(classifyCodexCliFailure("failed to initialize state runtime: readonly database")).toMatchObject({
      category: "local-runtime-or-sandbox",
      message: expect.stringMatching(/local Codex state/i)
    });
  });
});
