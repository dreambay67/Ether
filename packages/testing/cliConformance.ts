import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface DiscoveredCli {
  executable: string;
  cleanup: () => void;
}

export interface CliRunResult {
  status: number;
  output: string;
}

interface CliProbe {
  status: number | null;
  output: string;
  error?: Error;
}

function probeCli(executable: string, args: readonly string[]): CliProbe {
  const result = spawnSync(executable, [...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NO_COLOR: "1"
    },
    input: "",
    shell: false,
    timeout: 15_000,
    windowsHide: true
  });

  return {
    status: result.status,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    ...(result.error ? { error: result.error } : {})
  };
}

export function runCli(executable: string, args: readonly string[]): CliRunResult {
  const result = probeCli(executable, args);

  if (result.error) {
    throw new Error(
      `Unable to run ${executable} ${args.join(" ")}: ${result.error.message}`,
      { cause: result.error }
    );
  }

  return {
    status: result.status ?? -1,
    output: result.output
  };
}

function executablePathsFromPath(command: string): string[] {
  if (process.platform !== "win32") {
    const result = probeCli("which", [command]);
    return result.status === 0 ? result.output.split(/\r?\n/).filter(Boolean) : [];
  }

  const result = probeCli("where.exe", [command]);
  return result.status === 0 ? result.output.split(/\r?\n/).filter(Boolean) : [];
}

function uniqueExistingPaths(candidates: Array<string | undefined>): string[] {
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))]
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => existsSync(candidate));
}

function discoverCli(
  label: string,
  candidates: string[],
  versionPattern: RegExp,
  stageWindowsExecutable: boolean
): DiscoveredCli {
  const failures: string[] = [];

  for (const candidate of candidates) {
    const directProbe = probeCli(candidate, ["--version"]);
    if (directProbe.status === 0 && versionPattern.test(directProbe.output)) {
      return { executable: candidate, cleanup: () => undefined };
    }

    failures.push(
      `${candidate}: ${directProbe.error?.message ?? `exit ${String(directProbe.status)}: ${directProbe.output}`}`
    );

    if (!stageWindowsExecutable || process.platform !== "win32") {
      continue;
    }

    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "ether-cli-conformance-"));
    const stagedExecutable = path.join(temporaryDirectory, path.basename(candidate));

    try {
      copyFileSync(candidate, stagedExecutable);
      const stagedProbe = probeCli(stagedExecutable, ["--version"]);
      if (stagedProbe.status === 0 && versionPattern.test(stagedProbe.output)) {
        return {
          executable: stagedExecutable,
          cleanup: () => rmSync(temporaryDirectory, { force: true, recursive: true })
        };
      }

      failures.push(
        `${stagedExecutable}: ${stagedProbe.error?.message ?? `exit ${String(stagedProbe.status)}: ${stagedProbe.output}`}`
      );
    } catch (error) {
      failures.push(`${stagedExecutable}: ${error instanceof Error ? error.message : String(error)}`);
    }

    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  throw new Error(
    `${label} CLI is unavailable or incompatible. Checked:\n${failures.length > 0 ? failures.join("\n") : "no executable candidates found"}`
  );
}

export function discoverCodexCli(): DiscoveredCli {
  const candidates = uniqueExistingPaths([
    process.env.CODEX_CLI_PATH,
    ...executablePathsFromPath(process.platform === "win32" ? "codex.exe" : "codex")
  ]);

  return discoverCli("Codex", candidates, /^codex-cli \d+\.\d+\.\d+/m, true);
}

export function discoverAntigravityCli(): DiscoveredCli {
  const localExecutable = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
    : undefined;
  const candidates = uniqueExistingPaths([
    process.env.ANTIGRAVITY_CLI_PATH,
    ...executablePathsFromPath(process.platform === "win32" ? "agy.exe" : "agy"),
    localExecutable
  ]);

  return discoverCli("Antigravity", candidates, /^\d+\.\d+\.\d+$/m, false);
}
