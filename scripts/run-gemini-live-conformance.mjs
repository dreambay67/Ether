import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");
const configuredUserData = process.env.ETHER_GEMINI_CONFORMANCE_USER_DATA;

if (configuredUserData === undefined || !path.isAbsolute(configuredUserData)) {
  throw new Error(
    "Set ETHER_GEMINI_CONFORMANCE_USER_DATA to an absolute disposable profile containing the protected credential."
  );
}
const conformanceUserData = path.resolve(configuredUserData);

await access(executable).catch(() => {
  throw new Error("Build the reviewed Windows package before running Gemini live conformance.");
});
await access(path.join(conformanceUserData, "gemini-api-credential.json")).catch(() => {
  throw new Error("The disposable Gemini conformance profile does not contain the protected credential envelope.");
});

const result = await new Promise((resolve, reject) => {
  const child = spawn(executable, [
    `--user-data-dir=${conformanceUserData}`,
    "--validate-gemini-live"
  ], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    process.stdout.write(text);
    stdout = `${stdout}${text}`.slice(-64 * 1024);
  });
  child.stderr.pipe(process.stderr);
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Gemini live conformance was terminated by ${signal}.`));
      return;
    }
    resolve({ exitCode: code ?? 1, stdout });
  });
});

if (result.exitCode !== 0 || !/"state"\s*:\s*"passed"/u.test(result.stdout)) {
  throw new Error(`Gemini live conformance did not produce a passing result (exit code ${result.exitCode}).`);
}
