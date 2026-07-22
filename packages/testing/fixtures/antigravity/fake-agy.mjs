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
if (mode === "auth-failure") {
  process.stderr.write("Code Assist login required: Bearer agy-secret-token-123456789; token=agy-token-987654321; API-Key: agy-api-key-246813579\nhttps://accounts.google.com/o/oauth2/v2/auth?access_token=agy-url-secret-13579\n");
  process.exit(1);
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
