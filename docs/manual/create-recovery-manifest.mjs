import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createRecoveryManualManifest, recoveryManifestRelativePath } from "./recovery-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const manifest = await createRecoveryManualManifest(root);
const destination = path.join(root, ...recoveryManifestRelativePath.split("/"));
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Recorded ${manifest.captures.length} packaged manual captures from ${manifest.package.gitCommit}: ${destination}\n`);
