import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AntigravityImageProvider,
  buildAntigravityProcessCall,
  buildAntigravityPrompt,
  discoverAntigravityCli,
  extractExplicitProviderIdentity,
  redactSensitiveText,
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

function input(projectPath: string, references: GenerationProviderInput["references"] = []): GenerationProviderInput {
  return {
    workspacePath: projectPath,
    runId: "run-1",
    generationNodeId: "image",
    iteration: 1,
    prompt: "a small glass orb",
    negativePrompt: "text",
    sections: [], references, edgeRoles: [], outputCount: 1,
    requestedAt: "2026-07-22T00:00:00.000Z"
  };
}

function fakeRunner(env: Record<string, string | undefined>, calls: ProviderProcessCall[] = []) {
  return (call: ProviderProcessCall, options: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 15_000 }) => {
    calls.push(call);
    return runAntigravityProcess({
      ...call,
      command: process.execPath,
      args: [fixture, ...call.args],
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env, ...call.env })
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    }, options);
  };
}

async function readyProvider(
  profile: "nano-banana-2" | "nano-banana-pro" | "nano-banana-2-lite" = "nano-banana-2",
  mode = "success",
  creditOveragesPolicy: "never-confirmed" | "unverified" = "never-confirmed"
) {
  const projectPath = await root();
  const brainRoot = path.join(projectPath, "brain");
  const conformanceRoot = path.join(projectPath, "conformance");
  const calls: ProviderProcessCall[] = [];
  const env = { USERPROFILE: projectPath, ANTIGRAVITY_BRAIN_ROOT: brainRoot, FAKE_AGY_MODE: mode, PATH: process.env.PATH };
  await writeAntigravityConformance(conformanceRoot, {
    schemaVersion: 1, cli: { version: "1.1.4", sha256: "fixture-sha" }, createdAt: new Date().toISOString(),
    profiles: [{ requestedProfile: profile, result: "pass", lite1kVerified: profile === "nano-banana-2-lite" }]
  });
  return {
    projectPath,
    brainRoot,
    calls,
    provider: new AntigravityImageProvider(profile, {
      executablePath: "fake-agy",
      env,
      brainRoot,
      conformanceRoot,
      fileExists: async () => true,
      run: fakeRunner(env, calls),
      sha256File: async () => "fixture-sha",
      processTimeoutMs: 5_000,
      creditOveragesPolicy
    })
  };
}

describe("Antigravity image provider", () => {
  it("uses the official noninteractive command surface and imports only the newly discovered image", async () => {
    const { projectPath, brainRoot, provider, calls } = await readyProvider();
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
    const generationCall = calls.find((call) => call.args.includes("--sandbox"));
    expect(generationCall).toBeDefined();
    expect(generationCall?.cwd).toContain(path.join("staging", "antigravity-attempt-one-"));
    expect(generationCall?.args).toContain("--sandbox");
    expect(generationCall?.args.filter((arg) => arg === "--add-dir")).toHaveLength(1);
    expect(generationCall?.args[generationCall!.args.indexOf("--add-dir") + 1]).toBe(generationCall?.cwd);
    expect(generationCall?.env.NO_BROWSER).toBe("true");
    expect(generationCall?.env.SSH_CONNECTION).toBe("ether-antigravity-headless");
    expect(generationCall?.stdin).toBeUndefined();
  });

  it("runs ordinary diagnosis with --version only and leaves authentication unverified", async () => {
    const projectPath = await root();
    const calls: ProviderProcessCall[] = [];
    const env = { USERPROFILE: projectPath, PATH: process.env.PATH };
    const provider = new AntigravityImageProvider("nano-banana-2", {
      executablePath: "fake-agy",
      env,
      conformanceRoot: path.join(projectPath, "missing-conformance"),
      fileExists: async () => true,
      run: fakeRunner(env, calls),
      sha256File: async () => "fixture-sha"
    });

    await expect(provider.diagnose()).resolves.toMatchObject({
      availability: "unavailable",
      details: { authentication: "unverified", authenticated: false }
    });
    expect(calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("only probes models when explicit authentication probing is requested", async () => {
    const calls: ProviderProcessCall[] = [];
    const env = { USERPROFILE: await root(), PATH: process.env.PATH };
    await expect(discoverAntigravityCli({
      executablePath: "fake-agy",
      env,
      fileExists: async () => true,
      authProbe: true,
      run: fakeRunner(env, calls)
    })).resolves.toMatchObject({ authenticated: true, authentication: "probe-verified" });
    expect(calls.map((call) => call.args)).toEqual([["--version"], ["models"]]);
  });

  it("stages references and confines the CLI to the attempt directory", async () => {
    const { projectPath, provider, calls } = await readyProvider();
    const referenceRoot = await root();
    const referencePath = path.join(referenceRoot, "customer reference.png");
    await writeFile(referencePath, validPng);
    const stagingDirectory = path.join(projectPath, "staging");
    const result = await provider.generate(input(projectPath, [{
      nodeId: "reference",
      role: "style",
      title: "Customer reference",
      sourceKind: "Image",
      assetPath: referencePath
    }]), {
      signal: new AbortController().signal,
      providerAttemptId: "reference-attempt",
      attemptOrdinal: 1,
      stagingDirectory,
      complete: async () => undefined
    });
    const generationCall = calls.find((call) => call.args.includes("--sandbox"));
    expect(generationCall).toBeDefined();
    const attemptDirectory = generationCall!.cwd;
    const referenceDirectory = path.join(attemptDirectory, "references");
    const stagedNames = await readdir(referenceDirectory);
    expect(stagedNames).toHaveLength(1);
    expect(stagedNames[0]).toMatch(/^reference-001-[0-9a-f-]+\.png$/);
    await expect(readFile(path.join(referenceDirectory, stagedNames[0]!))).resolves.toEqual(validPng);
    expect(generationCall?.args).not.toContain(path.dirname(referencePath));
    expect(generationCall?.args.join(" ")).not.toContain(referencePath);
    expect(generationCall?.args.at(-1)).toContain(path.join("references", stagedNames[0]!));
    expect(result.artifacts[0]?.sourcePath).toContain(path.join(attemptDirectory, "imported"));
  });

  it("keeps the default credit-overages policy unavailable", async () => {
    const { provider } = await readyProvider("nano-banana-2", "success", "unverified");
    const diagnostic = await provider.diagnose();
    expect(diagnostic).toMatchObject({
      availability: "unavailable",
      details: { creditOveragesPolicy: "unverified" },
      messages: [expect.stringMatching(/Credit Overages.*Never/i)]
    });
    expect(diagnostic.messages.join(" ")).toMatch(/cannot override Google billing/i);
    await expect(provider.generate(input("unused"))).rejects.toThrow(/Credit Overages.*Never/i);
  });

  it("redacts auth markers and authentication URLs from errors and diagnostics", async () => {
    const redacted = redactSensitiveText("Bearer agy-secret-token-123456789 token=agy-token-987654321 API-Key: agy-api-key-246813579 https://accounts.google.com/o/oauth2/v2/auth?access_token=agy-url-secret-13579");
    expect(redacted).toContain("Bearer <redacted>");
    expect(redacted).toContain("token=<redacted>");
    expect(redacted).toContain("API-Key=<redacted>");
    expect(redacted).not.toMatch(/agy-secret-token|agy-token|agy-api-key|agy-url-secret|https?:\/\//);

    const { provider } = await readyProvider("nano-banana-2", "auth-failure");
    const error = await provider.generate(input("unused")).then(() => null, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toMatch(/agy-secret-token|agy-token|agy-api-key|agy-url-secret|https?:\/\//);
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
    expect(prompt).toContain("Do not use terminal, file-write, browser, MCP, or any other tools");
    expect(extractExplicitProviderIdentity("Provider model identity: Nano Banana 2\n")).toBe("Nano Banana 2");
    expect(extractExplicitProviderIdentity("Nano Banana 2 in a filename.png")).toBeNull();
  });

  it("rejects an add-dir outside the attempt directory", () => {
    expect(() => buildAntigravityProcessCall({
      executablePath: "agy",
      env: {},
      workspacePath: "C:\\original-project",
      request: {
        profile: "nano-banana-2",
        prompt: "prompt",
        attemptDirectory: "C:\\attempt",
        logPath: "C:\\attempt\\agy.log",
        timeoutMs: 1_000,
        addDirectories: ["C:\\attempt", "C:\\original-project"]
      }
    })).toThrow(/staged inside the attempt directory/i);
  });
});
