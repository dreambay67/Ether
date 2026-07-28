import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliAssistantProvider,
  CodexAppServerRuntime,
  CodexCliImageProvider,
  FakeImageProvider,
  PROVIDER_CONNECTION_ROLES,
  PROVIDER_PAYLOAD_CHANNELS,
  classifyCodexCliFailure,
  createCodexAppServerProviderBundle,
  createDefaultProviderRegistry,
  diagnoseProviderRegistry,
  hasBlockedOpenAiEnvKey,
  runProviderProcess,
  sanitizeProviderEnv,
  type GenerationProviderInput,
  type ProviderProcessCall
} from "@ether/providers";

const tempRoots: string[] = [];
const runtimeBundles: Array<ReturnType<typeof createCodexAppServerProviderBundle>> = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-provider-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(runtimeBundles.splice(0).map((bundle) => bundle.close()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createReadyCodexBundle() {
  const runtime = new CodexAppServerRuntime({
    executablePath: process.execPath,
    appServerArgs: [path.join(process.cwd(), "fixtures", "codex-app-server", "fake-app-server.mjs")],
    initializationTimeoutMs: 2_000
  });
  const bundle = createCodexAppServerProviderBundle({ runtime });
  runtimeBundles.push(bundle);
  await runtime.start();
  return bundle;
}

async function waitForCondition(condition: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false;
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function providerInput(projectPath: string): GenerationProviderInput {
  return {
    workspacePath: projectPath,
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
    outputCount: 1,
    requestedAt: "2026-06-17T13:00:00.000Z"
  };
}

const pngSignatureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);
const noIdatPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAElFTkSuQmCC",
  "base64"
);

describe("generation provider registry", () => {
  it("exports the provider payload channel and connection role vocabularies", () => {
    expect(PROVIDER_PAYLOAD_CHANNELS).toEqual(["text", "image", "mask", "data", "video", "audio"]);
    expect(PROVIDER_CONNECTION_ROLES).toEqual([
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
    ]);
  });

  it("does not activate Codex or OpenAI API routes from legacy options and environment alone", async () => {
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
      "google-nano-banana-2",
      "google-nano-banana-2-lite"
    ]);
    expect(providers.find((provider) => provider.id === "ether-fake-local")?.capabilities).toContain(
      "image.generate"
    );
    expect(diagnostics.policy.openAiPlatformApi).toMatchObject({
      status: "blocked",
      envKeyDetected: true
    });
    expect(diagnostics.providers.find((provider) => provider.id === "codex-chatgpt-image-2")).toMatchObject({
      availability: "unavailable",
      route: "codex-cli"
    });
    expect(diagnostics.providers.find((provider) => provider.id === "google-nano-banana-pro")).toMatchObject({
      availability: "unavailable",
      route: "antigravity-cli"
    });
  });

  it("does not expose requested Nano profiles as verified model identity", () => {
    const registry = createDefaultProviderRegistry();
    const descriptors = registry.listDescriptors().filter((provider) => provider.route === "antigravity-cli");
    expect(descriptors).toHaveLength(3);
    expect(descriptors.every((provider) => provider.model === undefined)).toBe(true);
  });

  it("reports a provider capability matrix with real, simulation, and experimental slots", async () => {
    const userProfile = await createTempRoot();
    const codexBundle = await createReadyCodexBundle();
    const registry = createDefaultProviderRegistry({
      codexBundle,
      antigravity: {
        conformanceRoot: path.join(userProfile, "conformance"),
        env: {
          USERPROFILE: userProfile,
          LOCALAPPDATA: userProfile,
          PATH: ""
        },
        fileExists: async () => false
      },
      env: {
        USERPROFILE: userProfile,
        OPENAI_API_KEY: "sk-should-stay-blocked"
      }
    });

    const diagnostics = await diagnoseProviderRegistry(registry, {
      env: {
        USERPROFILE: userProfile,
        OPENAI_API_KEY: "sk-should-stay-blocked"
      }
    });

    expect(diagnostics.matrix.map((provider) => provider.id)).toEqual([
      "codex-chatgpt-image-2",
      "codex-vision-assistant",
      "codex-vision-evaluation",
      "ether-fake-local",
      "api-image-generation",
      "api-assistant",
      "google-nano-banana-pro",
      "google-nano-banana-2",
      "google-nano-banana-2-lite",
      "adapter-audio-to-text",
      "adapter-video-to-text",
      "adapter-image-to-text",
      "adapter-video-to-image",
      "adapter-data-to-mask",
      "adapter-text-to-audio"
    ]);
    const antigravityRows = diagnostics.matrix.filter((provider) => provider.route === "antigravity-cli");
    expect(antigravityRows.every((provider) => provider.model === undefined)).toBe(true);
    expect(antigravityRows.every((provider) => provider.profiles.every((profile) => profile.model === undefined))).toBe(true);
    expect(diagnostics.matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex-chatgpt-image-2",
          displayName: "ChatGPT Image 2 / Codex image",
          availability: "available",
          status: "ready",
          mode: "real",
          capabilities: expect.arrayContaining(["image.generate", "image.edit", "image.reference-input"]),
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "image.generate",
              inputChannels: expect.arrayContaining(["text", "image"]),
              outputChannels: ["image"],
              availability: "available"
            }),
            expect.objectContaining({
              operation: "image.edit",
              inputChannels: expect.arrayContaining(["text", "image", "mask"]),
              outputChannels: ["image"],
              availability: "available"
            })
          ])
        }),
        expect.objectContaining({
          id: "codex-vision-assistant",
          displayName: "Codex assistant",
          availability: "available",
          status: "ready",
          mode: "real",
          capabilities: expect.arrayContaining(["assistant.text", "assistant.vision"]),
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "assistant.text",
              inputChannels: expect.arrayContaining(["text"]),
              outputChannels: ["text"]
            }),
            expect.objectContaining({
              operation: "assistant.vision",
              inputChannels: expect.arrayContaining(["text", "image"]),
              outputChannels: ["text"]
            })
          ])
        }),
        expect.objectContaining({
          id: "codex-vision-evaluation",
          displayName: "Codex evaluation",
          availability: "available",
          status: "ready",
          mode: "real",
          capabilities: expect.arrayContaining(["evaluation.vision"]),
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "evaluation.vision",
              inputChannels: expect.arrayContaining(["text", "image"]),
              outputChannels: ["data"]
            })
          ])
        }),
        expect.objectContaining({
          id: "ether-fake-local",
          displayName: "Simulation Mode fake provider",
          availability: "available",
          status: "ready",
          mode: "simulation",
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "image.generate",
              capabilitySource: "simulation",
              outputChannels: ["image"]
            }),
            expect.objectContaining({
              operation: "image.edit",
              capabilitySource: "simulation",
              outputChannels: ["image"]
            })
          ])
        }),
        expect.objectContaining({
          id: "api-image-generation",
          displayName: "Optional API generation slot",
          availability: "unavailable",
          status: "experimental",
          mode: "experimental",
          readiness: "disabled",
          noHiddenFallback: true,
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "image.generate",
              availability: "unavailable",
              requiresExplicitSelection: true,
              noHiddenFallback: true
            }),
            expect.objectContaining({
              operation: "image.edit",
              availability: "unavailable",
              requiresExplicitSelection: true,
              noHiddenFallback: true
            })
          ])
        }),
        expect.objectContaining({
          id: "api-assistant",
          displayName: "Optional API assistant slot",
          availability: "unavailable",
          status: "experimental",
          mode: "experimental",
          readiness: "disabled",
          noHiddenFallback: true,
          profiles: expect.arrayContaining([
            expect.objectContaining({
              operation: "assistant.text",
              availability: "unavailable",
              requiresExplicitSelection: true,
              noHiddenFallback: true
            }),
            expect.objectContaining({
              operation: "assistant.vision",
              availability: "unavailable",
              requiresExplicitSelection: true,
              noHiddenFallback: true
            })
          ])
        }),
        expect.objectContaining({
          id: "google-nano-banana-pro",
          displayName: "Nano Banana Pro",
          availability: "unavailable",
          status: "experimental",
          mode: "experimental",
          route: "antigravity-cli",
          unavailableReason: expect.stringMatching(/conformance|authentication|not found|not live-probed/i)
        }),
        expect.objectContaining({
          id: "google-nano-banana-2",
          displayName: "Nano Banana 2",
          availability: expect.stringMatching(/^(?:available|unavailable)$/),
          status: "experimental",
          mode: "experimental",
          route: "antigravity-cli"
        }),
        expect.objectContaining({
          id: "google-nano-banana-2-lite",
          displayName: "Nano Banana 2 Lite",
          availability: "unavailable",
          status: "experimental",
          mode: "experimental",
          route: "antigravity-cli",
          unavailableReason: expect.stringMatching(/conformance|authentication|not found|not live-probed/i),
          profiles: [expect.objectContaining({ mediaLimits: expect.objectContaining({ maxWidth: 1024, maxHeight: 1024 }) })]
        }),
        expect.objectContaining({
          id: "adapter-audio-to-text",
          profiles: [
            expect.objectContaining({
              operation: "adapter.transcribe",
              inputChannels: ["audio"],
              outputChannels: ["text"],
              availability: "unavailable",
              unavailableReason: expect.stringMatching(/not configured/i),
              noHiddenFallback: true
            })
          ]
        }),
        expect.objectContaining({
          id: "adapter-video-to-text",
          profiles: [
            expect.objectContaining({
              operation: "adapter.caption",
              inputChannels: ["video"],
              outputChannels: ["text"],
              noHiddenFallback: true
            })
          ]
        }),
        expect.objectContaining({
          id: "adapter-image-to-text",
          profiles: [
            expect.objectContaining({
              operation: "adapter.caption",
              inputChannels: ["image"],
              outputChannels: ["text"],
              unavailableReason: expect.stringMatching(/conservative/i),
              noHiddenFallback: true
            })
          ]
        }),
        expect.objectContaining({
          id: "adapter-video-to-image",
          profiles: [
            expect.objectContaining({
              operation: "adapter.extract",
              inputChannels: ["video"],
              outputChannels: ["image"],
              noHiddenFallback: true
            })
          ]
        }),
        expect.objectContaining({
          id: "adapter-data-to-mask",
          profiles: [
            expect.objectContaining({
              operation: "adapter.transform",
              inputChannels: ["data"],
              outputChannels: ["mask"],
              noHiddenFallback: true
            })
          ]
        }),
        expect.objectContaining({
          id: "adapter-text-to-audio",
          profiles: [
            expect.objectContaining({
              operation: "adapter.transform",
              inputChannels: ["text"],
              outputChannels: ["audio"],
              noHiddenFallback: true
            })
          ]
        })
      ])
    );
    expect(diagnostics.policy.openAiPlatformApi).toMatchObject({
      status: "blocked",
      envKeyDetected: true
    });
    expect(
      diagnostics.matrix.filter((provider) => provider.id.startsWith("api-")).every((provider) => provider.noHiddenFallback)
    ).toBe(true);
    expect(
      diagnostics.matrix
        .filter((provider) => provider.id.startsWith("adapter-"))
        .every((provider) =>
          provider.availability === "unavailable" &&
          provider.unavailableReason &&
          provider.noHiddenFallback &&
          provider.profiles.every((profile) => profile.noHiddenFallback && Boolean(profile.unavailableReason))
        )
    ).toBe(true);
  });

  it("reuses one runtime-backed Codex bundle for generation, assistant, and evaluation diagnostics", async () => {
    const codexBundle = await createReadyCodexBundle();
    const registry = createDefaultProviderRegistry({
      codexBundle
    });

    const diagnostics = await diagnoseProviderRegistry(registry);

    expect(
      diagnostics.matrix.filter((provider) =>
        ["codex-chatgpt-image-2", "codex-vision-assistant", "codex-vision-evaluation"].includes(
          provider.id
        )
      )
    ).toEqual([
      expect.objectContaining({
        id: "codex-chatgpt-image-2",
        availability: "available",
        status: "ready"
      }),
      expect.objectContaining({
        id: "codex-vision-assistant",
        availability: "available",
        status: "ready"
      }),
      expect.objectContaining({
        id: "codex-vision-evaluation",
        availability: "available",
        status: "ready"
      })
    ]);
    const codexDetails = diagnostics.matrix
      .filter((provider) => provider.id.startsWith("codex-"))
      .map((provider) => provider.details);
    expect(codexDetails).toHaveLength(3);
    expect(codexDetails[1]).toEqual(codexDetails[0]);
    expect(codexDetails[2]).toEqual(codexDetails[0]);
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
      fileName: "fake-output-generation-2.png",
      mimeType: "image/png"
    });
    expect(Buffer.from(first.artifacts[0]?.content as Uint8Array).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(Buffer.from(first.artifacts[0]?.content as Uint8Array).includes(Buffer.from("IEND"))).toBe(true);
  });

  it("produces deterministic fake edit artifacts for offline edit and upscale tests", async () => {
    const projectPath = await createTempRoot();
    const provider = new FakeImageProvider();
    const editInput = {
      workspacePath: projectPath,
      runId: "run-edit-1",
      editNodeId: "edit-upscale",
      editSubtype: "Upscale",
      operation: "upscale",
      iteration: 1,
      prompt: "make the edges cleaner",
      negativePrompt: "",
      instruction: "2x clean presentation upscale",
      notes: "retain proportions",
      sections: [],
      references: [],
      edgeRoles: [],
      sourceImage: {
        assetId: "parent-asset-1",
        assetKind: "generated",
        assetPath: path.join(projectPath, "parent.svg"),
        assetMetadata: { generationNodeId: "generation" }
      },
      mask: null,
      requestedAt: "2026-06-17T13:30:00.000Z"
    };
    const first = await (provider as any).edit(editInput);
    const second = await (provider as any).edit(editInput);

    expect(provider.descriptor.capabilities).toEqual(
      expect.arrayContaining(["image.generate", "image.edit", "image.reference-input"])
    );
    expect(first).toEqual(second);
    expect(first.providerId).toBe("ether-fake-local");
    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]).toMatchObject({
      fileName: "fake-edit-edit-upscale-upscale-1.png",
      mimeType: "image/png",
      metadata: {
        deterministic: true,
        operation: "upscale",
        localTool: {
          kind: "fake-deterministic-upscale",
          route: "local-fake"
        }
      }
    });
    expect(Buffer.from(first.artifacts[0]?.content as Uint8Array).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  it("supports deterministic retryable failure and cancellation", async () => {
    const projectPath = await createTempRoot();
    const failing = new FakeImageProvider({ failAttempts: [1] });
    await expect(
      failing.generate(providerInput(projectPath), {
        signal: new AbortController().signal,
        providerAttemptId: "attempt-one",
        attemptOrdinal: 1,
        stagingDirectory: projectPath,
        complete: async () => undefined
      })
    ).rejects.toMatchObject({ code: "FAKE_RETRYABLE_FAILURE", retryable: true });

    const controller = new AbortController();
    const delayed = new FakeImageProvider({ delayMs: 100 });
    const pending = delayed.generate(providerInput(projectPath), {
      signal: controller.signal,
      providerAttemptId: "attempt-cancelled",
      attemptOrdinal: 2,
      stagingDirectory: projectPath,
      complete: async () => undefined
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("produces the requested number of deterministic PNG artifacts in stable order", async () => {
    const projectPath = await createTempRoot();
    const provider = new FakeImageProvider();
    const input = { ...providerInput(projectPath), outputCount: 2 };

    const first = await provider.generate(input);
    const second = await provider.generate(input);

    expect(first).toEqual(second);
    expect(first.artifacts.map((artifact) => artifact.fileName)).toEqual([
      "fake-output-generation-2-0001.png",
      "fake-output-generation-2-0002.png"
    ]);
    expect(first.artifacts).toHaveLength(2);
    for (const artifact of first.artifacts) {
      expect(Buffer.from(artifact.content as Uint8Array).subarray(0, 8)).toEqual(pngSignatureBytes);
    }
  });

  it("removes delayed fake-provider abort listeners after resolve", async () => {
    const projectPath = await createTempRoot();
    const provider = new FakeImageProvider({ delayMs: 1 });
    const controller = new AbortController();

    for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
      await provider.generate(providerInput(projectPath), {
        signal: controller.signal,
        providerAttemptId: `listener-attempt-${ordinal}`,
        attemptOrdinal: ordinal,
        stagingDirectory: projectPath,
        complete: async () => undefined
      });
    }

    expect(getEventListeners(controller.signal, "abort")).toEqual([]);
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
        const prompt = (call as ProviderProcessCall & { stdin?: string }).stdin ?? "";
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(prompt)?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex stdin prompt.");
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
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Do not use OPENAI_API_KEY");
    expect(result.artifacts[0]).toMatchObject({
      fileName: "image.png",
      mimeType: "image/png"
    });
    await expect(readFile(result.artifacts[0]!.sourcePath!)).resolves.toEqual(validPngBytes);
  });

  it("builds a Codex CLI vision assistant invocation with reference images and no API keys", async () => {
    const projectPath = await createTempRoot();
    const referencePath = path.join(projectPath, "reference.png");
    await writeFile(referencePath, "reference");
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliAssistantProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      env: {
        OPENAI_API_KEY: "sk-must-not-leak",
        PATH: "C:\\Windows\\System32"
      },
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        const prompt = (call as ProviderProcessCall & { stdin?: string }).stdin ?? "";
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(prompt)?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex assistant stdin prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-assistant-assistant",
            status: "complete",
            text: "The reference image suggests a glossy red campaign texture.",
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "{\"ok\":true}", stderr: "", exitCode: 0 };
      }
    });

    const result = await provider.run({
      workspacePath: projectPath,
      runId: "run-assistant",
      assistantNodeId: "assistant",
      assistantSubtype: "Brainstormer",
      prompt: "Use the product reference to shape a launch concept.",
      instruction: "Describe visual directions.",
      notes: "Keep it concise.",
      sections: [
        {
          nodeId: "prompt",
          kind: "prompt",
          section: "General",
          title: "General Prompt",
          text: "premium glossy product campaign"
        }
      ],
      references: [
        {
          nodeId: "reference",
          role: "style",
          title: "Uploaded reference",
          sourceKind: "Image",
          assetPath: referencePath
        }
      ],
      edgeRoles: [{ edgeId: "edge-reference-assistant", role: "style" }],
      requestedAt: "2026-06-26T08:00:00.000Z"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--image",
        referencePath
      ])
    );
    expect(calls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0]?.args.join(" ")).not.toContain("sk-must-not-leak");
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Inspect any supplied images directly");
    expect(result).toMatchObject({
      providerId: "codex-vision-assistant",
      text: "The reference image suggests a glossy red campaign texture."
    });
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
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec((call as ProviderProcessCall & { stdin?: string }).stdin ?? "")?.[1]?.trim();
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
            error: "native image generation unavailable",
            caveats: ""
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
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec((call as ProviderProcessCall & { stdin?: string }).stdin ?? "")?.[1]?.trim();
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
            error: null,
            caveats: ""
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
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec((call as ProviderProcessCall & { stdin?: string }).stdin ?? "")?.[1]?.trim();
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
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/not valid PNG bytes/i);
  });

  it("rejects CRC-valid Codex PNG outputs without IDAT image data", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec((call as ProviderProcessCall & { stdin?: string }).stdin ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, noIdatPngBytes);
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
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(providerInput(projectPath))).rejects.toThrow(/IDAT/i);
  });

  it("reports a useful error when Codex result.json points at a missing image.png", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec((call as ProviderProcessCall & { stdin?: string }).stdin ?? "")?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-2",
            status: "complete",
            image_path: path.join(outputDir, "image.png"),
            error: null,
            caveats: ""
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

  it("terminates provider process trees after timeout", async () => {
    const projectPath = await createTempRoot();
    const childPidPath = path.join(projectPath, "child.pid");
    const parentScript = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
        detached: process.platform === "win32",
        stdio: "ignore"
      });
      child.unref();
      writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
      setInterval(() => {}, 1000);
    `;
    let childPid: number | undefined;

    try {
      await expect(
        runProviderProcess(
          {
            command: process.execPath,
            args: ["-e", parentScript],
            cwd: projectPath,
            env: {}
          },
          {
            timeoutMs: 1000,
            outputLimitBytes: 64
          }
        )
      ).rejects.toThrow(/timed out/i);

      await expect(waitForCondition(async () => access(childPidPath).then(() => true, () => false))).resolves.toBe(
        true
      );
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(Number.isInteger(childPid)).toBe(true);
      await expect(waitForCondition(() => !isProcessRunning(childPid!))).resolves.toBe(true);
    } finally {
      if (childPid && isProcessRunning(childPid)) {
        try {
          process.kill(childPid);
        } catch {
          // Best-effort cleanup for the intentionally orphaned pre-fix child process.
        }
      }
    }
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
