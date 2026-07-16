import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliAssistantProvider,
  CodexCliImageProvider,
  runProviderProcess,
  type AssistantProviderInput,
  type GenerationProviderInput,
  type ImageEditProviderInput,
  type ProviderProcessCall
} from "@ether/providers";
import {
  createAssistantWorkerRequest,
  createImageEditWorkerRequest,
  createImageWorkerRequest,
  readAssistantWorkerResult,
  readCodexImageWorkerResult,
  readEvaluationWorkerResult
} from "../../providers/src/codex.js";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-provider-contract-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

function imageInput(projectPath: string): GenerationProviderInput {
  return {
    projectPath,
    runId: "run-1",
    generationNodeId: "generation",
    iteration: 1,
    prompt: "clean product render",
    negativePrompt: "blur",
    sections: [],
    references: [],
    edgeRoles: [],
    output: {
      aspectRatio: "16:9",
      resolution: "1536-long-edge",
      width: 1536,
      height: 864
    },
    requestedAt: "2026-06-28T10:00:00.000Z"
  };
}

function assistantInput(projectPath: string): AssistantProviderInput {
  return {
    projectPath,
    runId: "run-assistant",
    assistantNodeId: "assistant",
    assistantSubtype: "Brainstormer",
    prompt: "Suggest a visual direction.",
    instruction: "Keep it concise.",
    notes: "",
    sections: [],
    references: [],
    edgeRoles: [],
    requestedAt: "2026-06-28T10:00:00.000Z"
  };
}

function editInput(projectPath: string): ImageEditProviderInput {
  return {
    projectPath,
    runId: "run-edit",
    editNodeId: "edit",
    editSubtype: "Inpaint",
    operation: "inpaint",
    iteration: 1,
    prompt: "clean up the corner",
    negativePrompt: "",
    instruction: "remove the mark",
    notes: "",
    sections: [],
    references: [],
    edgeRoles: [],
    sourceImage: {
      assetId: "source-1",
      assetKind: "generated",
      assetPath: path.join(projectPath, "source.png"),
      assetMetadata: { width: 100 }
    },
    mask: {
      assetId: "mask-1",
      assetPath: path.join(projectPath, "mask.png"),
      assetMetadata: { width: 100 }
    },
    requestedAt: "2026-06-28T10:00:00.000Z"
  };
}

async function outputDirFromCall(call: ProviderProcessCall) {
  const prompt = (call as ProviderProcessCall & { stdin?: string }).stdin ?? "";
  const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(prompt)?.[1]?.trim();

  if (!outputDir) {
    throw new Error("Output directory was not included in the Codex stdin prompt.");
  }

  return outputDir;
}

const validPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);
const pngSignatureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("Codex provider worker contracts", () => {
  it("accepts a valid image worker request and result", async () => {
    const projectPath = await createTempRoot();
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        const outputDir = await outputDirFromCall(call);
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, validPngBytes);
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-1",
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

    const result = await provider.generate(imageInput(projectPath));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Required JSON shape");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Aspect ratio: 16:9");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Resolution: 1536 x 864 px");
    expect(result.artifacts[0]).toMatchObject({
      fileName: "image.png",
      mimeType: "image/png"
    });
    await expect(readFile(result.artifacts[0]!.sourcePath!)).resolves.toEqual(validPngBytes);
  });

  it("rejects malformed image worker JSON", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = await outputDirFromCall(call);
        await writeFile(path.join(outputDir, "result.json"), "{not-json", "utf8");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.generate(imageInput(projectPath))).rejects.toThrow(/not valid JSON/i);
  });

  it("rejects missing required image output", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = await outputDirFromCall(call);
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-1",
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

    await expect(provider.generate(imageInput(projectPath))).rejects.toThrow(/required PNG output was not found/i);
  });

  it("rejects corrupt image output", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = await outputDirFromCall(call);
        const imagePath = path.join(outputDir, "image.png");
        await writeFile(imagePath, Buffer.concat([pngSignatureBytes, Buffer.from("not a real PNG")]));
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-1-generation-1",
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

    await expect(provider.generate(imageInput(projectPath))).rejects.toThrow(/not valid PNG bytes/i);
  });

  it("rejects malformed image worker request array element schemas", async () => {
    const projectPath = await createTempRoot();
    const validInput = imageInput(projectPath);

    expect(() =>
      createImageWorkerRequest(
        {
          ...validInput,
          sections: [{ nodeId: "prompt", kind: "system", section: "General", title: "Title", text: "Text" }]
        } as unknown as GenerationProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/sections\[0\]\.kind/i);

    expect(() =>
      createImageWorkerRequest(
        {
          ...validInput,
          references: [{ nodeId: "ref", role: "style", title: "Style", sourceKind: 7 }]
        } as unknown as GenerationProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/references\[0\]\.sourceKind/i);

    expect(() =>
      createImageWorkerRequest(
        {
          ...validInput,
          edgeRoles: [{ edgeId: "edge-1", role: null }]
        } as unknown as GenerationProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/edgeRoles\[0\]\.role/i);
  });

  it("rejects malformed edit worker source and mask schemas", async () => {
    const projectPath = await createTempRoot();
    const validInput = editInput(projectPath);

    expect(() =>
      createImageEditWorkerRequest(
        {
          ...validInput,
          sourceImage: {
            ...validInput.sourceImage,
            assetMetadata: "wide"
          }
        } as unknown as ImageEditProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/sourceImage\.assetMetadata/i);

    expect(() =>
      createImageEditWorkerRequest(
        {
          ...validInput,
          mask: {
            assetId: 12,
            assetPath: path.join(projectPath, "mask.png")
          }
        } as unknown as ImageEditProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/mask\.assetId/i);
  });

  it("rejects malformed assistant worker request array element schemas", async () => {
    const projectPath = await createTempRoot();
    const validInput = assistantInput(projectPath);

    expect(() =>
      createAssistantWorkerRequest(
        {
          ...validInput,
          sections: [{ nodeId: "prompt", kind: "negativePrompt", section: "General", title: 3, text: "Text" }]
        } as unknown as AssistantProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/sections\[0\]\.title/i);

    expect(() =>
      createAssistantWorkerRequest(
        {
          ...validInput,
          references: [{ nodeId: "ref", role: "style", title: "Style", sourceKind: "Image", assetPath: 5 }]
        } as unknown as AssistantProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/references\[0\]\.assetPath/i);

    expect(() =>
      createAssistantWorkerRequest(
        {
          ...validInput,
          edgeRoles: [{ edgeId: "edge-1" }]
        } as unknown as AssistantProviderInput,
        path.join(projectPath, "outputs")
      )
    ).toThrow(/edgeRoles\[0\]\.role/i);
  });

  it("rejects image worker results missing required contract fields", async () => {
    const projectPath = await createTempRoot();
    const resultPath = path.join(projectPath, "result.json");

    await writeFile(
      resultPath,
      JSON.stringify({
        status: "complete",
        image_path: path.join(projectPath, "image.png"),
        error: null,
        caveats: ""
      }),
      "utf8"
    );
    await expect(readCodexImageWorkerResult(resultPath)).rejects.toThrow(/result\.json id/i);

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "run-1-generation-1",
        status: "complete",
        image_path: path.join(projectPath, "image.png"),
        caveats: ""
      }),
      "utf8"
    );
    await expect(readCodexImageWorkerResult(resultPath)).rejects.toThrow(/result\.json error/i);

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "run-1-generation-1",
        status: "complete",
        image_path: path.join(projectPath, "image.png"),
        error: null
      }),
      "utf8"
    );
    await expect(readCodexImageWorkerResult(resultPath)).rejects.toThrow(/result\.json caveats/i);
  });

  it("rejects assistant and evaluation worker results missing required contract fields", async () => {
    const projectPath = await createTempRoot();
    const resultPath = path.join(projectPath, "result.json");

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "run-assistant-assistant",
        status: "complete",
        error: null,
        caveats: ""
      }),
      "utf8"
    );
    await expect(readAssistantWorkerResult(resultPath)).rejects.toThrow(/result\.json text/i);

    await writeFile(
      resultPath,
      JSON.stringify({
        status: "complete",
        text: "Direction text.",
        error: null,
        caveats: ""
      }),
      "utf8"
    );
    await expect(readAssistantWorkerResult(resultPath)).rejects.toThrow(/result\.json id/i);

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "eval-1",
        status: "complete",
        score: null,
        error: null,
        caveats: ""
      }),
      "utf8"
    );
    await expect(readEvaluationWorkerResult(resultPath)).rejects.toThrow(/result\.json text/i);

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "eval-1",
        status: "complete",
        score: null,
        text: "Looks aligned.",
        error: null
      }),
      "utf8"
    );
    await expect(readEvaluationWorkerResult(resultPath)).rejects.toThrow(/result\.json caveats/i);
  });

  it("rejects evaluation worker results with blank explanations", async () => {
    const projectPath = await createTempRoot();
    const resultPath = path.join(projectPath, "result.json");

    await writeFile(
      resultPath,
      JSON.stringify({
        id: "eval-1",
        status: "complete",
        items: [
          {
            id: "image-1",
            assetId: "asset-1",
            score: 82,
            tags: ["keeper"],
            decision: "pass",
            confidence: 0.8,
            explanation: "   ",
            detectedIssues: []
          }
        ],
        summary: "One image passed.",
        error: null,
        caveats: ""
      }),
      "utf8"
    );

    await expect(readEvaluationWorkerResult(resultPath)).rejects.toThrow(/items\[0\]\.explanation/i);
  });

  it("reports process runner timeouts with bounded output", async () => {
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
    ).rejects.toThrow(/timed out[\s\S]*\[truncated/i);
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
          // Best-effort cleanup for the intentionally orphaned child process.
        }
      }
    }
  });

  it("validates assistant worker result schema", async () => {
    const projectPath = await createTempRoot();
    const provider = new CodexCliAssistantProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        const outputDir = await outputDirFromCall(call);
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-assistant-assistant",
            status: "complete",
            text: "Direction text.",
            error: null,
            caveats: 42
          }),
          "utf8"
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(provider.run(assistantInput(projectPath))).rejects.toThrow(/assistant worker result\.json/i);
  });
});
