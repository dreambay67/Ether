import { mkdir } from "node:fs/promises";
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
  const saveQueue = [campaignPath, renamedPath, copyPath];
  const initialDocument = argumentValue("--open-document=");
  const referenceFixture = process.argv.includes("--reference-capabilities");

  const started = await startEtherDesktop({
    rendererUrl: pathToFileURL(path.join(repositoryRoot, "apps", "desktop", "dist", "index.html")).href,
    initialArgv: initialDocument === null ? [] : [initialDocument],
    simulationMode: !process.argv.includes("--production-controls"),
    locationCapability: process.argv.includes("--read-only-location")
      ? { classify: () => "unknown" }
      : undefined,
    autosaveOperation: process.argv.includes("--autosave-failure")
      ? async () => { throw Object.assign(new Error("Fixture autosave failure"), { code: "ENOSPC" }); }
      : undefined,
    serviceFactory: referenceFixture ? createReferenceFixtureService : undefined,
    dialogs: {
      openDocument: async () => renamedPath,
      saveDocument: async () => saveQueue.shift() ?? null,
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
}

function argumentValue(prefix) {
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix));
  return argument === undefined ? null : path.resolve(argument.slice(prefix.length));
}

function createReferenceFixtureService(options) {
  const service = new DesktopApplicationService(options);
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
  service.actOnReference = async () => references;
  return service;
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
