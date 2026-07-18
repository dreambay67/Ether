import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app } from "electron";
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

  await startEtherDesktop({
    rendererUrl: pathToFileURL(path.join(repositoryRoot, "apps", "desktop", "dist", "index.html")).href,
    dialogs: {
      openDocument: async () => renamedPath,
      saveDocument: async () => saveQueue.shift() ?? null,
      locateReference: async () => null,
      searchReferenceFolder: async () => null
    }
  });
}
