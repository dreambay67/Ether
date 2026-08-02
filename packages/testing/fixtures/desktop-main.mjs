import { access, mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app } from "electron";
import { desktopIpcChannels } from "../../../apps/desktop/dist-electron/shared/ipc/channels.js";
import { DesktopApplicationService } from "../../../apps/desktop/dist-electron/main/services/applicationService.js";
import { startEtherDesktop } from "../../../apps/desktop/dist-electron/main/main.js";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, "..", "..", "..");

void runFixture().catch((error) => {
  console.error(error);
  app.exit(1);
});

async function runFixture() {
  const rootArgument = process.argv.find((argument) => argument.startsWith("--fixture-root="));
  if (rootArgument === undefined) throw new Error("Desktop fixture requires --fixture-root.");
  const fixtureRoot = path.resolve(rootArgument.slice("--fixture-root=".length));
  const documentsRoot = path.join(fixtureRoot, "documents");
  await mkdir(documentsRoot, { recursive: true });
  app.setPath("userData", path.join(fixtureRoot, "user-data"));

  const campaignPath = path.join(documentsRoot, "Campaign with spaces.ether");
  const renamedPath = path.join(documentsRoot, "Kampa\u0148 \u03a9.ether");
  const copyPath = path.join(documentsRoot, "Campaign copy.ether");
  const configuredSavePaths = argumentValues("--save-path=");
  const saveQueue = configuredSavePaths.length === 0 ? [campaignPath, renamedPath, copyPath] : configuredSavePaths;
  const initialDocument = argumentValue("--open-document=");
  const referenceFixture = process.argv.includes("--reference-capabilities");
  const autosaveGate = argumentValue("--autosave-gate=");
  const saveAsGate = argumentValue("--save-as-gate=");
  const quitGate = argumentValue("--quit-gate=");
  const startupQuitGate = argumentValue("--startup-quit-gate=");
  const mutationGate = mutationGateArgument();

  const started = await startEtherDesktop({
    rendererUrl: pathToFileURL(path.join(repositoryRoot, "apps", "desktop", "dist", "index.html")).href,
    initialArgv: initialDocument === null ? [] : [initialDocument],
    simulationMode: !process.argv.includes("--production-controls"),
    locationCapability: process.argv.includes("--read-only-location")
      ? {
          classify: (filePath) => initialDocument !== null && path.resolve(filePath) === initialDocument
            ? "unknown"
            : "local-fixed"
        }
      : undefined,
    autosaveOperation: process.argv.includes("--autosave-failure")
      ? async () => { throw Object.assign(new Error("Fixture autosave failure"), { code: "ENOSPC" }); }
      : autosaveGate === null ? undefined : async () => waitForGate(autosaveGate),
    serviceFactory: startupQuitGate !== null
      ? (options) => new DesktopApplicationService({
          ...options,
          bootstrapOperation: async () => {
            await writeFile(`${startupQuitGate}.started`, "started", "utf8");
            app.quit();
            await waitForGate(startupQuitGate);
            await writeFile(`${startupQuitGate}.bootstrap-released`, "released", "utf8");
          }
        })
      : referenceFixture || mutationGate !== null
        ? (options) => createFixtureService(options, { mutationGate, referenceFixture })
        : undefined,
    dialogs: {
      openDocument: async () => process.argv.includes("--read-only-location") && initialDocument !== null
        ? initialDocument
        : renamedPath,
      saveDocument: async (kind) => {
        if (kind === "save-as" && saveAsGate !== null) await waitForGate(saveAsGate);
        const destination = saveQueue.shift() ?? null;
        if (kind === "save-as" && saveAsGate !== null) {
          await writeFile(`${saveAsGate}.selected`, destination ?? "cancelled", "utf8");
        }
        return destination;
      },
      locateReference: async () => null,
      searchReferenceFolder: async () => null,
      confirmPortable: async () => !process.argv.includes("--portable-cancel")
    }
  });
  if (process.argv.includes("--stale-event")) {
    setTimeout(() => {
      const snapshot = started.service.snapshot();
      started.mainWindow.webContents.send(desktopIpcChannels.document.event, {
        kind: "snapshot",
        documentId: snapshot.documentId,
        revision: 0,
        saveState: "saved",
        snapshot: { ...snapshot, revision: 0, saveState: "saved" }
      });
    }, 2_500);
  }
  if (quitGate !== null) {
    app.on("before-quit", () => {
      writeFileSync(`${quitGate}.observed`, "before-quit", "utf8");
    });
    void waitForGate(quitGate).then(() => app.quit());
  }
}

async function waitForGate(gatePath) {
  await writeFile(`${gatePath}.started`, "started", "utf8");
  while (true) {
    try {
      await access(gatePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function argumentValue(prefix) {
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix));
  return argument === undefined ? null : path.resolve(argument.slice(prefix.length));
}

function argumentValues(prefix) {
  return process.argv
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => path.resolve(argument.slice(prefix.length)));
}

function createFixtureService(options, { mutationGate, referenceFixture }) {
  const service = new DesktopApplicationService({
    ...options,
    mutationOperationCheckpoint: mutationGate === null
      ? undefined
      : async (operation) => {
          if (operation === mutationGate.operation) await waitForGate(mutationGate.path);
        }
  });
  if (!referenceFixture) return service;
  const references = [
    reference("limited", ["locate", "search-folder", "relink-all", "remove"]),
    reference("full", [
      "locate",
      "search-folder",
      "relink-all",
      "use-embedded-preview",
      "embed-available-copy",
      "remove"
    ])
  ];
  service.listReferences = async () => references;
  return service;
}

function mutationGateArgument() {
  for (const operation of ["graph", "reference", "portable"]) {
    const gate = argumentValue(`--${operation}-gate=`);
    if (gate !== null) return { operation, path: gate };
  }
  return null;
}

function reference(name, actions) {
  return {
    id: `reference-${name}`,
    displayName: `${name}.png`,
    mediaType: "image/png",
    state: "missing",
    actions
  };
}
