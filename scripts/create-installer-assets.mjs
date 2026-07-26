import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../packages/application/node_modules/sharp/dist/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(rootDir, "packages", "brand", "src", "assets");

/** Create the NSIS icon and companion PNGs from the reviewed repo-local brand assets. */
export async function createInstallerAssets(root = rootDir) {
  const source = path.join(root, "packages", "brand", "src", "assets");
  const output = path.join(root, "build", "installer");
  await mkdir(output, { recursive: true });
  const etherSource = path.join(source, "Ether_logo.png");
  await Promise.all([
    cp(etherSource, path.join(output, "ether.png")),
    cp(path.join(source, "DB_logo.png"), path.join(output, "dreambay.png"))
  ]);
  const iconPng = await sharp(await readFile(etherSource))
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await writeFile(path.join(output, "ether.ico"), pngIco(iconPng));
}

function pngIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); // 0 encodes 256 pixels.
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.byteLength, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createInstallerAssets().then(() => console.log(`Installer assets refreshed from ${sourceDir}`));
}
