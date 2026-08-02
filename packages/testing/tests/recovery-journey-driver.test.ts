import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JourneyActionRecorder,
  RealPageInput,
  assertPackagedJourneyArgs,
  assertReusableJourneyProfile,
  createIsolatedJourneyProfile,
  journeyProfileCleanupPolicy,
  assertAuthoringJourneyDeclaration,
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  collectJourneyBuildIdentity,
  journeyEvidencePaths,
  sha256File
} from "../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Ether recovery journey driver", () => {
  it("records exact Git/build identity and SHA-256 artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ether-recovery-hash-"));
    const artifact = path.join(tempRoot, "artifact.txt");
    try {
      await writeFile(artifact, "Ether recovery identity\n", "utf8");
      expect(await sha256File(artifact)).toBe("8f16b2af30e3cbe360b460f172205191899dab4bdcafaa0524353830cf5856aa");
      const identity = await collectJourneyBuildIdentity(workspaceRoot, "source-electron", [artifact]);
      expect(identity.gitCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(identity).toMatchObject({
        mode: "source-electron",
        artifacts: [{ path: "artifact.txt", sha256: "8f16b2af30e3cbe360b460f172205191899dab4bdcafaa0524353830cf5856aa" }]
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps every real input mode distinct in sequential action evidence", async () => {
    const recorder = recorderFor("driver-input-contract");
    const calls: string[] = [];
    const page = {
      mouse: {
        click: async (_x: number, _y: number, options: { button: string }) => { calls.push(`click:${options.button}`); },
        move: async (_x: number, _y: number, options?: { steps?: number }) => { calls.push(`move:${options?.steps ?? 0}`); },
        down: async (options: { button: string }) => { calls.push(`down:${options.button}`); },
        up: async (options: { button: string }) => { calls.push(`up:${options.button}`); },
        dblclick: async (_x: number, _y: number, options: { button: string }) => { calls.push(`double:${options.button}`); }
      },
      keyboard: {
        down: async (key: string) => { calls.push(`key-down:${key}`); },
        up: async (key: string) => { calls.push(`key-up:${key}`); },
        press: async (key: string) => { calls.push(`key-press:${key}`); },
        type: async (text: string) => { calls.push(`type:${text}`); }
      }
    };
    const input = new RealPageInput(page as never, recorder);

    await input.leftClick({ x: 10, y: 20 }, "Select a node", "A left click is sent.");
    await input.leftDrag({ x: 10, y: 20 }, { x: 30, y: 40 }, "Move a node", "A left drag is sent.");
    await input.leftMarquee({ x: 12, y: 22 }, { x: 52, y: 62 }, "Marquee", "A left marquee is sent.");
    await input.shiftMarquee({ x: 13, y: 23 }, { x: 53, y: 63 }, "Add marquee", "A Shift marquee is sent.");
    await input.rightDragPan({ x: 14, y: 24 }, { x: 54, y: 64 }, "Pan", "A right drag is sent.");
    await input.pressKey("Control+D", "Duplicate", "The keyboard shortcut is sent.");

    expect(recorder.snapshot().actions.map((action) => action.kind)).toEqual([
      "left-click", "left-drag", "left-marquee", "shift-marquee", "right-drag-pan", "keyboard-command"
    ]);
    expect(calls).toContain("key-down:Shift");
    expect(calls).toContain("key-up:Shift");
    expect(calls).toContain("down:right");
    expect(calls).toContain("key-press:Control+D");
  });

  it("formats human-readable logs and captures console, page, and main-process errors", () => {
    const recorder = recorderFor("driver-log-contract");
    recorder.record({
      kind: "left-click",
      label: "Add Prompt",
      expected: "A Prompt node is added.",
      actual: "Left click at (10, 20).",
      durationMs: 8,
      screenshotPath: "screenshots/01-prompt.png"
    });
    recorder.captureConsoleError("Renderer failed to load a control.");
    recorder.capturePageError(new Error("Unhandled renderer exception"));
    recorder.captureMainProcessOutput("info ready\nError: main process request failed\nfinished");
    recorder.finish("failed");

    const log = recorder.snapshot();
    expect(log.errors).toEqual([
      { source: "console", message: "Renderer failed to load a control." },
      { source: "page", message: "Unhandled renderer exception" },
      { source: "main-process", message: "Error: main process request failed" }
    ]);
    expect(recorder.toMarkdown()).toContain("Git commit: 0123456789abcdef0123456789abcdef01234567");
    expect(recorder.toMarkdown()).toContain("screenshots/01-prompt.png");
    expect(recorder.toMarkdown()).toContain("Captured errors");
  });

  it("rejects seeded graphs, direct bridge mutations, database edits, and fixture injection", () => {
    expect(() => assertAuthoringJourneyDeclaration({
      ...blankAuthoringJourney("guard-contract"),
      graphSource: "pre-seeded" as never
    })).toThrow(/pre-seeded graph/u);
    expect(() => assertAuthoringJourneyDeclaration({
      ...blankAuthoringJourney("guard-contract"),
      mutationPath: "direct-bridge" as never
    })).toThrow(/direct bridge mutation/u);
    expect(() => assertAuthoringJourneyDeclaration({
      ...blankAuthoringJourney("guard-contract"),
      storagePath: "database" as never
    })).toThrow(/database/u);
    expect(() => assertAuthoringJourneySourceSafety("window.ether.graph.applyTransaction(documentId, transaction)", "fixture"))
      .toThrow(/direct bridge graph mutation/u);
    expect(() => assertAuthoringJourneySourceSafety("window.ether.application.command({ name: 'graph.applyTransaction' })", "fixture"))
      .toThrow(/direct bridge application command/u);
    expect(() => assertAuthoringJourneySourceSafety("page.addInitScript(() => fixtureGraph)", "fixture"))
      .toThrow(/fixture injection/u);
    expect(() => assertAuthoringJourneySourceSafety("database.exec('update graph')", "fixture"))
      .toThrow(/database edit/u);
    expect(() => assertAuthoringJourneyDeclaration(blankAuthoringJourney("fake-provider", "fake"))).not.toThrow();
  });

  it("accepts a document reopen argument but retains driver ownership of isolated packaged flags", () => {
    expect(() => assertPackagedJourneyArgs(["C:\\journeys\\UI-authored.ether"])).not.toThrow();
    for (const argument of [
      "--user-data-dir=C:\\unsafe",
      "--user-data-dir",
      "--remote-debugging-port=9222",
      "--remote-debugging-port"
    ]) {
      expect(() => assertPackagedJourneyArgs([argument])).toThrow(/driver-owned isolation/u);
    }
  });

  it("preserves a supplied recovery profile by default, cleans it only when requested, and rejects outside roots", async () => {
    const profile = await createIsolatedJourneyProfile();
    const outside = await mkdtemp(path.join(os.tmpdir(), "ether-untrusted-profile-"));
    try {
      expect(journeyProfileCleanupPolicy(false, undefined)).toBe(true);
      expect(journeyProfileCleanupPolicy(true, undefined)).toBe(false);
      expect(journeyProfileCleanupPolicy(true, true)).toBe(true);
      expect(journeyProfileCleanupPolicy(true, false)).toBe(false);
      await expect(assertReusableJourneyProfile(profile)).resolves.toBeUndefined();

      const outsideProfile = {
        ...profile,
        root: outside,
        appData: path.join(outside, "AppData"),
        localAppData: path.join(outside, "LocalAppData"),
        userData: path.join(outside, "LocalAppData", "Ether")
      };
      await Promise.all([mkdir(outsideProfile.appData, { recursive: true }), mkdir(outsideProfile.userData, { recursive: true })]);
      await expect(assertReusableJourneyProfile(outsideProfile)).rejects.toThrow(/outside the scoped temp root/u);
    } finally {
      await rm(profile.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps committed evidence deterministic and raw traces under ignored test results", () => {
    const committed = journeyEvidencePaths(workspaceRoot, "phase-0", "source-electron", "committed");
    const nestedCommitted = journeyEvidencePaths(
      workspaceRoot,
      "phase-0",
      "packaged",
      "committed",
      ["phase-0", "authoring-baseline"]
    );
    const ephemeral = journeyEvidencePaths(workspaceRoot, "phase-0", "packaged", "ephemeral");
    expect(committed.root.replaceAll("\\", "/")).toContain("docs/evidence/ether-4.0-recovery/phase-0/source-electron");
    expect(nestedCommitted.root.replaceAll("\\", "/")).toContain("phase-0/authoring-baseline/packaged");
    expect(ephemeral.root.replaceAll("\\", "/")).toContain("test-results/recovery/phase-0/packaged/");
  });
});

function recorderFor(journeyId: string): JourneyActionRecorder {
  return new JourneyActionRecorder({
    journeyId,
    mode: "source-electron",
    identity: {
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      mode: "source-electron",
      artifacts: [{ path: "apps/desktop/dist/index.html", sha256: "a".repeat(64) }]
    },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }
  });
}
