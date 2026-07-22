import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AntigravityImageProvider,
  buildAntigravityPrompt,
  extractExplicitProviderIdentity,
  runAntigravityProcess,
  writeAntigravityConformance,
  type GenerationProviderInput,
  type ProviderProcessCall
} from "@ether/providers";

const roots: string[] = [];
const fixture = path.join(process.cwd(), "fixtures", "antigravity", "fake-agy.mjs");
const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "ether-antigravity-"));
  roots.push(value);
  return value;
}

function input(projectPath: string): GenerationProviderInput {
  return {
    projectPath,
    runId: "run-1",
    generationNodeId: "image",
    iteration: 1,
    prompt: "a small glass orb",
    negativePrompt: "text",
    sections: [], references: [], edgeRoles: [], outputCount: 1,
    requestedAt: "2026-07-22T00:00:00.000Z"
  };
}

function fakeRunner(env: Record<string, string | undefined>) {
  return (call: ProviderProcessCall, options: { timeoutMs: number; signal?: AbortSignal }) => runAntigravityProcess({
    ...call,
    command: process.execPath,
    args: [fixture, ...call.args],
    env: { ...process.env, ...env, ...call.env }
  }, options);
}

async function readyProvider(profile: "nano-banana-2" | "nano-banana-pro" | "nano-banana-2-lite" = "nano-banana-2", mode = "success") {
  const projectPath = await root();
  const brainRoot = path.join(projectPath, "brain");
  const conformanceRoot = path.join(projectPath, "conformance");
  const env = { USERPROFILE: projectPath, ANTIGRAVITY_BRAIN_ROOT: brainRoot, FAKE_AGY_MODE: mode, PATH: process.env.PATH };
  await writeAntigravityConformance(conformanceRoot, {
    schemaVersion: 1, cli: { version: "1.1.4", sha256: "fixture-sha" }, createdAt: new Date().toISOString(),
    profiles: [{ requestedProfile: profile, result: "pass", lite1kVerified: profile === "nano-banana-2-lite" }]
  });
  return {
    projectPath,
    brainRoot,
    provider: new AntigravityImageProvider(profile, {
      executablePath: "fake-agy",
      env,
      brainRoot,
      conformanceRoot,
      fileExists: async () => true,
      run: fakeRunner(env),
      sha256File: async () => "fixture-sha",
      processTimeoutMs: 5_000
    })
  };
}

describe("Antigravity image provider", () => {
  it("uses the official noninteractive command surface and imports only the newly discovered image", async () => {
    const { projectPath, brainRoot, provider } = await readyProvider();
    await mkdir(brainRoot, { recursive: true });
    await writeFile(path.join(brainRoot, "old.png"), validPng);
    const result = await provider.generate(input(projectPath), {
      signal: new AbortController().signal,
      providerAttemptId: "attempt-one", attemptOrdinal: 1, stagingDirectory: path.join(projectPath, "staging"), complete: async () => undefined
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.sourcePath).toContain("antigravity-attempt-one");
    expect(result.artifacts[0]?.metadata).toMatchObject({ requestedProfile: "nano-banana-2", dimensions: { width: 1, height: 1 } });
    expect(result.metadata).toMatchObject({ providerIdentity: null, requestedProfile: "nano-banana-2" });
  });

  it("keeps requested profile and provider identity separate, disables unsupported profiles, and redacts diagnostics", async () => {
    const { provider } = await readyProvider("nano-banana-pro");
    await expect(provider.diagnose()).resolves.toMatchObject({ availability: "available", details: { providerIdentity: null, requestedProfile: "nano-banana-pro" } });
    const rootPath = await root();
    const lite = new AntigravityImageProvider("nano-banana-2-lite", {
      executablePath: "fake-agy", env: { USERPROFILE: rootPath, PATH: process.env.PATH }, brainRoot: path.join(rootPath, "brain"), conformanceRoot: path.join(rootPath, "none"),
      fileExists: async () => true, run: fakeRunner({ USERPROFILE: rootPath, PATH: process.env.PATH }), sha256File: async () => "fixture-sha"
    });
    await expect(lite.diagnose()).resolves.toMatchObject({ availability: "unavailable", messages: [expect.stringMatching(/conformance/i)] });
  });

  it("excludes stale artifacts and reports malformed output rather than treating prose as success", async () => {
    const { projectPath, brainRoot, provider } = await readyProvider("nano-banana-2", "stale-only");
    await mkdir(brainRoot, { recursive: true });
    await writeFile(path.join(brainRoot, "old.png"), validPng);
    await expect(provider.generate(input(projectPath))).rejects.toThrow(/exactly one newly created valid image/i);
  });

  it("terminates the fake CLI on timeout and cancellation", async () => {
    const call: ProviderProcessCall = { command: process.execPath, args: [fixture], cwd: process.cwd(), env: { ...process.env, FAKE_AGY_MODE: "slow" } };
    await expect(runAntigravityProcess(call, { timeoutMs: 30 })).rejects.toThrow(/timed out/i);
    const controller = new AbortController();
    const pending = runAntigravityProcess(call, { timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it("builds the exact restricted image instruction contract", () => {
    const prompt = buildAntigravityPrompt("nano-banana-2", { prompt: "subject", negativePrompt: "text" });
    expect(prompt).toContain("built-in generative image tool exactly once");
    expect(prompt).toContain("exactly one image using Nano Banana 2");
    expect(prompt).toContain("Do not use terminal, file-write, browser, or any other tools");
    expect(extractExplicitProviderIdentity("Provider model identity: Nano Banana 2\n")).toBe("Nano Banana 2");
    expect(extractExplicitProviderIdentity("Nano Banana 2 in a filename.png")).toBeNull();
  });
});
