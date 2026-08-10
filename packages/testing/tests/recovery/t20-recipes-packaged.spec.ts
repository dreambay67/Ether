import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile,
  sourceElectronJourneyConfig,
  type RealPageInput,
  type RecoveryJourneySession
} from "../../recovery/journeyDriver.js";
import { completeNativeFolderDialogWithUia } from "../../recovery/nativeFolderDialog.js";
import { findExactPackagedProcessId } from "../../recovery/windowsIntegration.js";
import {
  completeHumanCheckpoint,
  createSourceArtifact,
  fitRecipe,
  nodeByTitle,
  publishRecipeMask,
  runRecipe,
  waitForJobStatus,
  type T20RecipeJourney
} from "./t20RecipeJourneyHelpers.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

type T20RecipeCase = T20RecipeJourney & {
  nodes: number;
  outputTitle: string;
  requiresNativeFolderGrant?: boolean;
};

const recipes: readonly T20RecipeCase[] = [
  { id: "prompt-to-image", title: "Prompt to Image", nodes: 4, runTitle: "Generate image", outputTitle: "Generate image", calls: 1, checkpoint: true },
  { id: "reference-guided-image", title: "Reference-Guided Image", nodes: 4, runTitle: "Guided image", outputTitle: "Guided image", calls: 1, checkpoint: true, requiresArtifact: true },
  { id: "moodboard-to-variations", title: "Moodboard to Variations", nodes: 4, runTitle: "Extract visual direction", outputTitle: "Generate variations", calls: 2, checkpoint: true, requiresArtifact: true },
  { id: "draft-lite-finish-pro", title: "Draft with Lite, Finish with Pro", nodes: 4, runTitle: "Draft with Lite", outputTitle: "Finish with Pro", calls: 2, checkpoint: true },
  { id: "character-consistency-sheet", title: "Character Consistency Sheet", nodes: 7, runTitle: "Sheet views", outputTitle: "Generate sheet", calls: 4, checkpoint: true, batch: true, requiresArtifact: true },
  { id: "product-campaign-set", title: "Product Campaign Set", nodes: 7, runTitle: "Campaign formats", outputTitle: "Produce campaign images", calls: 4, checkpoint: true, batch: true, requiresArtifact: true },
  { id: "infographic-builder", title: "Infographic Builder", nodes: 4, runTitle: "Plan hierarchy", outputTitle: "Render infographic", calls: 2, checkpoint: true },
  { id: "image-edit-with-mask", title: "Image Edit with Mask", nodes: 5, runTitle: "Apply edit", outputTitle: "Apply edit", calls: 1, checkpoint: true, requiresArtifact: true, requiresMask: true },
  { id: "reference-description-to-prompt", title: "Reference Description to Prompt", nodes: 3, runTitle: "Describe visual language", outputTitle: "Describe visual language", calls: 1, checkpoint: false, requiresArtifact: true },
  { id: "batch-variations-contact-sheet", title: "Batch Variations and Contact Sheet", nodes: 6, runTitle: "Variation matrix", outputTitle: "Generate batch", calls: 6, checkpoint: true, batch: true },
  { id: "evaluate-and-route", title: "Evaluate and Route", nodes: 6, runTitle: "Human compare", outputTitle: "Evaluate quality", calls: 1, checkpoint: true, requiresArtifact: true },
  { id: "curate-collect-export", title: "Curate, Collect, and Export", nodes: 6, runTitle: "Curate candidates", outputTitle: "Quality check", calls: 1, checkpoint: true, requiresArtifact: true, requiresNativeFolderGrant: true }
];

test.skip(process.platform !== "win32", "The T20 recipe journeys operate the packaged Windows Ether application.");
test.describe.configure({ mode: "serial" });

for (const recipe of recipes) {
  test(`${recipe.title} begins from a fresh blank document through the Recipe Gallery`, async () => {
    assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T20 packaged recipe journey spec");
    const journeyId = `t20-recipe-${recipe.id}`;
    const session = await launchRecoveryJourney({
      ...(sourceElectronDiagnostic ? sourceElectronJourneyConfig(workspaceRoot, journeyId) : packagedJourneyConfig(workspaceRoot, journeyId)),
      evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
      ...(sourceElectronDiagnostic ? {
        sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
        sourceArgs: (profile) => [
          `--fixture-root=${profile.root}`,
          `--output-folder=${path.join(profile.root, "source-recipe-exports")}`
        ]
      } : {
        committedEvidencePath: ["phase-4", "t20-recipes", journeyId],
        packagedArgs: (profile) => [`--ether-recovery-simulation=${recoveryShellTokenForProfile(profile)}`]
      }),
      viewport: { width: 1600, height: 1000 },
      declaration: blankAuthoringJourney(journeyId, "fake")
    });
    let closed = false;
    let nativeExportFolder: string | null = null;
    try {
      const { page, input, evidence } = session;
      const canvas = page.getByTestId("ether-canvas-surface");
      await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
      await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

      if (recipe.requiresArtifact === true) {
        await createSourceArtifact(page, input);
        await expect(canvas).toHaveAttribute("data-graph-node-count", "2");
      }

      await input.leftClick(page.getByRole("button", { name: "Recipes", exact: true }), `Open ${recipe.title} in Recipe Gallery`, "The blank document reaches its built-in recipes through the ordinary Gallery command.");
      const gallery = page.getByRole("dialog", { name: "Recipe Gallery" });
      await expect(gallery).toBeVisible();
      const card = gallery.getByTestId(`recipe-card-${recipe.id}`);
      await expect(card).toContainText(recipe.title);

      await input.leftClick(card, `Choose ${recipe.title}`, "The versioned built-in recipe loads its real setup sheet and token-scoped fake-provider readiness through the application boundary.");
      const setup = page.getByTestId("recipe-setup-sheet");
      await expect(setup).toBeVisible();
      await expect(setup).toContainText(recipe.title);
      await expect(setup.locator(".recipe-capability-missing")).toHaveCount(0);

      if (recipe.requiresArtifact === true) {
        const artifactInput = setup.getByLabel(/artifact choices$/u);
        await expect(artifactInput).toHaveCount(1);
        await expect(setup.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
        const artifactId = await artifactInput.locator("option").evaluateAll((options) => options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value.length > 0) ?? null);
        expect(artifactId).not.toBeNull();
        await artifactInput.selectOption(artifactId!);
        const previewButton = setup.getByRole("button", { name: "Preview", exact: true });
        if (recipe.requiresNativeFolderGrant === true) await expect(previewButton).toBeDisabled();
        else await expect(previewButton).toBeEnabled();
      }

      if (recipe.requiresNativeFolderGrant === true) {
        if (sourceElectronDiagnostic) {
          nativeExportFolder = path.join(session.profile.root, "source-recipe-exports");
          await input.leftClick(setup.getByRole("button", { name: /Choose export folder/u }), "Choose the source diagnostic export folder", "The source host returns a disposable isolated folder so the graph Export path can be debugged before packaging.");
          await expect(setup.getByRole("button", { name: "Choose export folder", exact: true })).toContainText("source-recipe-exports");
        } else {
          nativeExportFolder = await choosePackagedExportFolder(session, setup, input);
        }
      }

      const preview = setup.getByRole("button", { name: "Preview", exact: true });
      await expect(preview).toBeEnabled();
      await input.leftClick(preview, `Preview ${recipe.title}`, "The Gallery validates the current document artifact, exact call range, and token-scoped fake-provider substitutions before insertion.");
      await expect(page.getByTestId("recipe-gallery-status")).toContainText("Preview ready");
      await input.leftClick(setup.getByRole("button", { name: "Insert recipe", exact: true }), `Insert ${recipe.title}`, "The Gallery inserts the prepared built-in graph as one undoable ordinary UI transaction without starting provider work.");
      await expect(gallery).toBeHidden();
      await expect(canvas).toHaveAttribute("data-graph-node-count", String(recipe.nodes + (recipe.requiresArtifact === true ? 2 : 0)));
      await fitRecipe(page, input);

      if (recipe.requiresMask === true) await publishRecipeMask(page, input);
      await runRecipe(page, input, recipe);

      if (recipe.checkpoint) {
        await completeHumanCheckpoint(page, input);
        await waitForJobStatus(page, input, "completed", "Wait for the recipe to finish after human review", recipe.requiresArtifact === true ? 2 : 1);
      } else {
        await waitForJobStatus(page, input, "completed", "Wait for the advertised fake Worker output", recipe.requiresArtifact === true ? 2 : 1);
      }

      if (nativeExportFolder !== null) {
        await expect.poll(async () => (await exportedFiles(nativeExportFolder!)).length, {
          timeout: 30_000,
          message: "The selected native export folder did not receive a verified file."
        }).toBeGreaterThan(0);
        const [firstFile] = await exportedFiles(nativeExportFolder);
        expect(firstFile).toBeDefined();
        expect((await readFile(path.join(nativeExportFolder, firstFile!))).byteLength).toBeGreaterThan(0);
      }

      await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Build", exact: true }), `Inspect ${recipe.title} output`, "The recipe returns to its visible canvas with the fake-provider output persisted.");
      const outputNode = nodeByTitle(page, recipe.outputTitle);
      await input.leftClick(outputNode.locator(".ether-node-title"), `Select ${recipe.title} output node`, "The advertised fake-provider output is inspected on the inserted recipe itself.");
      await expect(page.getByTestId("output-versions")).not.toContainText("No output versions yet");
      await input.screenshot(`${recipe.id}-fake-output.png`, evidence, `Capture ${recipe.title} fake-provider output`, "This fresh-document recipe was configured, inserted, explicitly previewed, permitted, and completed through ordinary controls using only the recovery simulation.");

      input.observe(`${recipe.title} packaged recipe`, "The built-in workflow reaches its advertised fake-provider output from a fresh document through visible setup and run controls.", `The journey inserted ${recipe.nodes} recipe nodes${recipe.requiresArtifact === true ? " after visibly generating and selecting a real current-document source artifact" : ""}, reviewed an immutable ${recipe.calls}-call plan, and completed the durable result without any real provider.`);

      await session.close("passed");
      closed = true;
    } finally {
      if (!closed) await session.close("failed");
    }
  });
}

async function choosePackagedExportFolder(
  session: RecoveryJourneySession,
  setup: Locator,
  input: RealPageInput
): Promise<string> {
  const destination = path.join(session.profile.root, "recipe-exports");
  await mkdir(destination, { recursive: true });
  const ownerPid = await findExactPackagedProcessId(
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
    session.profile.userData
  );
  await input.leftClick(
    setup.getByRole("button", { name: /Choose export folder/u }),
    "Choose the Curate recipe export folder",
    "The packaged app opens its exact owner-scoped native directory dialog only after the visible setup action."
  );
  await completeNativeFolderDialogWithUia(ownerPid, destination);
  await expect(setup.getByRole("button", { name: "Choose export folder", exact: true })).toContainText("recipe-exports");
  return destination;
}

async function exportedFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}
