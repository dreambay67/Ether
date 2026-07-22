import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE ?? "success";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

if (args.includes("--version")) {
  process.stdout.write("1.1.4\n");
  process.exit(0);
}
if (args[0] === "models") {
  process.stdout.write("Gemini 3.5 Flash (Medium)\n");
  process.exit(0);
}
if (mode === "slow") {
  setInterval(() => {}, 1_000);
} else if (mode !== "stale-only") {
  const root = process.env.ANTIGRAVITY_BRAIN_ROOT;
  if (!root) throw new Error("ANTIGRAVITY_BRAIN_ROOT is required by fake agy.");
  const destination = path.join(root, `conversation-${Date.now()}`, "generated.png");
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, png);
}
process.stdout.write("completed\n");
