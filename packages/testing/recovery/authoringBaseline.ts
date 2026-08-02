import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JourneyEvidencePaths, JourneyLog, JourneyMode } from "./journeyDriver.js";

export const AUTHORING_BASELINE_CODES = [
  "BL-01-node-library",
  "BL-02-marquee-pointer",
  "BL-03-graph-shortcuts",
  "BL-04-primary-inline-edit",
  "BL-05-groups-modules"
] as const;

export type AuthoringBaselineCode = typeof AUTHORING_BASELINE_CODES[number];

export type AuthoringBaselineObservation = {
  code: AuthoringBaselineCode;
  expectedRejectedBehavior: string;
  actual: string;
  matchesRejectedCandidate: boolean;
  hesitationOrWorkaround: string;
};

export type AuthoringBaselineReport = {
  schemaVersion: 1;
  mode: JourneyMode;
  observations: AuthoringBaselineObservation[];
};

export async function writeAuthoringBaselineReport(
  evidence: JourneyEvidencePaths,
  report: AuthoringBaselineReport
): Promise<void> {
  assertObservationSet(report);
  const reportPath = path.join(evidence.root, "observations.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writePhaseZeroBaselineSummary(evidence.root);
}

export async function validateAuthoringBaselineEvidence(
  evidence: JourneyEvidencePaths,
  mode: JourneyMode
): Promise<void> {
  const [journeyLog, report] = await Promise.all([
    readJson<JourneyLog>(evidence.result),
    readJson<AuthoringBaselineReport>(path.join(evidence.root, "observations.json"))
  ]);
  if (journeyLog.mode !== mode || report.mode !== mode) throw new Error(`Baseline evidence mode mismatch for ${mode}.`);
  if (journeyLog.outcome !== "baseline-defects-reproduced") throw new Error("Baseline journey did not record its defect-reproduction outcome.");
  assertObservationSet(report);
  const expectedInputs = ["left-click", "left-drag", "left-marquee", "shift-marquee", "right-drag-pan", "keyboard-command", "inline-text-edit", "screenshot"];
  const actualInputs = new Set(journeyLog.actions.map((action) => action.kind));
  for (const input of expectedInputs) {
    if (!actualInputs.has(input as typeof journeyLog.actions[number]["kind"])) {
      throw new Error(`Baseline evidence is missing real input kind ${input}.`);
    }
  }
  for (const [index, action] of journeyLog.actions.entries()) {
    if (action.sequence !== index + 1) throw new Error("Baseline action sequence is not contiguous.");
  }
  const screenshots = journeyLog.actions.flatMap((action) => action.screenshotPath === undefined ? [] : [path.join(evidence.root, action.screenshotPath)]);
  if (screenshots.length === 0) throw new Error("Baseline evidence is missing post-action screenshots.");
  for (const screenshot of screenshots) await assertNontrivialPng(screenshot);
  const humanLog = await readFile(evidence.actionLog, "utf8");
  for (const forbidden of ["window.ether", "initialGraph", "addInitScript", "DesktopApplicationService", "database.exec", "sqlite."]) {
    if (humanLog.includes(forbidden)) throw new Error(`Baseline action log contains a prohibited authoring indicator: ${forbidden}.`);
  }
  if (!/^[a-f0-9]{40}$/u.test(journeyLog.identity.gitCommit)) throw new Error("Baseline action log lacks an exact Git commit.");
  if (journeyLog.identity.artifacts.length === 0 || journeyLog.identity.artifacts.some((artifact) => artifact.sha256 === null)) {
    throw new Error("Baseline action log lacks a complete build/package hash identity.");
  }
}

export async function writePhaseZeroBaselineSummary(modeRoot: string): Promise<void> {
  const baselineRoot = path.dirname(modeRoot);
  const modes = await Promise.all(["source-electron", "packaged"].map(async (mode) => {
    const directory = path.join(baselineRoot, mode);
    try {
      const [log, report] = await Promise.all([
        readJson<JourneyLog>(path.join(directory, "result.json")),
        readJson<AuthoringBaselineReport>(path.join(directory, "observations.json"))
      ]);
      return { mode, log, report };
    } catch {
      return null;
    }
  }));
  const populated = modes.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const rows = AUTHORING_BASELINE_CODES.map((code) => {
    const cells = populated.map(({ report }) => {
      const observation = report.observations.find((candidate) => candidate.code === code);
      return observation === undefined ? "not captured" : observation.matchesRejectedCandidate ? "reproduced" : "changed from rejected candidate";
    });
    return `| ${code} | ${cells.join(" | ")} |`;
  }).join("\n");
  const identity = populated.map(({ mode, log }) => `${mode}: ${log.identity.gitCommit}; ${log.identity.artifacts.map((artifact) => `${artifact.path}=${artifact.sha256}`).join(", ")}`).join("\n");
  const findings = populated.flatMap(({ mode, report }) => report.observations
    .filter((observation) => !observation.matchesRejectedCandidate)
    .map((observation) => `- ${mode} ${observation.code}: ${observation.actual}`));
  const screenshotCounts = await Promise.all(populated.map(async ({ mode }) => {
    const screenshots = path.join(baselineRoot, mode, "screenshots");
    try {
      return `${mode}: ${(await readdir(screenshots)).filter((file) => file.endsWith(".png")).length} screenshots`;
    } catch {
      return `${mode}: screenshots unavailable`;
    }
  }));
  const header = populated.map((entry) => entry.mode).join(" | ");
  await writeFile(path.join(baselineRoot, "summary.md"),
    "# Phase 0 authoring baseline\n\n" +
    "This is a rejected-candidate reproduction record, not candidate acceptance evidence. All authoring state was created through ordinary blank-document UI actions.\n\n" +
    `## Captured modes\n\n${identity || "No baseline run has been captured."}\n\n` +
    `## Observation status\n\n| Defect code | ${header || "capture pending"} |\n| --- | ${populated.map(() => "---").join(" | ") || "---"} |\n${rows}\n\n` +
    `## Screenshots\n\n${screenshotCounts.join("\n") || "No screenshots captured."}\n\n` +
    `## Divergences from the rejected candidate\n\n${findings.join("\n") || "None recorded in captured modes."}\n`,
    "utf8"
  );
}

function assertObservationSet(report: AuthoringBaselineReport): void {
  if (report.schemaVersion !== 1) throw new Error("Authoring baseline report has an unsupported schema version.");
  const codes = report.observations.map((observation) => observation.code);
  if (codes.length !== AUTHORING_BASELINE_CODES.length || new Set(codes).size !== codes.length || AUTHORING_BASELINE_CODES.some((code) => !codes.includes(code))) {
    throw new Error("Authoring baseline report must contain each stable defect code exactly once.");
  }
  for (const observation of report.observations) {
    if (!observation.actual || !observation.expectedRejectedBehavior || !observation.hesitationOrWorkaround) {
      throw new Error(`Authoring baseline observation ${observation.code} lacks required detail.`);
    }
  }
}

async function assertNontrivialPng(filePath: string): Promise<void> {
  const [bytes, information] = await Promise.all([readFile(filePath), stat(filePath)]);
  if (information.size < 10_000 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Baseline screenshot is not a nontrivial PNG: ${filePath}.`);
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
