import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig
} from "../../recovery/journeyDriver.js";
import {
  addShellNodes,
  assertAdaptiveShell,
  assertCollapsedPanePersistenceAfterReload,
  assertPanePersistenceAfterReload,
  collapseAllPanes,
  movePromptNode,
  resizeEveryPane,
  restoreAllPanes,
  scrollAndFocusBuildTools,
  scrollResponsiveShell,
  shellScaleMatrix,
  targetTextChannel,
  visitWorkspaces
} from "./t22PackagedShellHelpers.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);

test.skip(process.platform !== "win32", "The T22 shell matrix operates the packaged Windows Ether application.");
test.describe.configure({ mode: "serial" });

for (const point of shellScaleMatrix) {
  test(`T22 keeps the packaged shell usable at ${point.viewport.width}x${point.viewport.height} logical pixels with ${Math.round(point.scale * 100)}% Chromium scale`, async () => {
    assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T22 packaged shell matrix");
    const journeyId = `t22-shell-${point.id}`;
    const session = await launchRecoveryJourney({
      ...packagedJourneyConfig(workspaceRoot, journeyId),
      evidenceMode: "committed",
      committedEvidencePath: ["phase-5", "t22-packaged-shell-matrix", point.id],
      packagedArgs: () => [`--force-device-scale-factor=${point.scale}`],
      viewport: point.viewport,
      declaration: blankAuthoringJourney(journeyId)
    });
    let closed = false;
    try {
      const { page, input, evidence } = session;
      await visitWorkspaces(page, input);
      const { prompt, image } = await addShellNodes(page, input);
      await assertAdaptiveShell(page, point);

      if (point.id === "1920x1080-100") {
        await collapseAllPanes(page, input);
        await assertCollapsedPanePersistenceAfterReload(page, input);
        await restoreAllPanes(page, input);
        const resized = await resizeEveryPane(page, input);
        await assertPanePersistenceAfterReload(page, input, resized);
      } else if (point.id === "1440x900-125") {
        await scrollAndFocusBuildTools(page, input);
      } else {
        await scrollResponsiveShell(page, input);
        if (point.id === "1280x720-150") {
          await movePromptNode(page, input, prompt);
        } else {
          await targetTextChannel(page, input, prompt, image);
        }
      }

      await assertAdaptiveShell(page, point);
      input.observe(
        `T22 packaged ${point.id} checkpoint`,
        `The exact packaged Ether workspace remains usable at ${point.viewport.width}x${point.viewport.height} logical pixels with forced Chromium device scale ${point.scale}.`,
        `This maps to the nominal ${point.display.width}x${point.display.height} matrix point, but does not claim that the host Windows display resolution or DPI setting changed. The candidate began blank and used only ordinary pointer/keyboard interactions.`
      );
      await input.screenshot(
        `t22-shell-${point.id}.png`,
        evidence,
        `Capture packaged shell ${point.id}`,
        "The final visible workspace records the forced Chromium-scale/logical-viewport checkpoint after its documented action."
      );
      await session.close("passed");
      closed = true;
    } finally {
      if (!closed) await session.close("failed");
    }
  });
}
