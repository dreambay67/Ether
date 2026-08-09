import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { extractFile } from "@electron/asar";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { invokeExactOwnedNativeButtonWithUia } from "../../recovery/windowsIntegration.js";
import {
  assertPackagedInventoryMatches,
  cleanupReleaseStaging,
  createStagedInventory,
  inventoryAsarPayload,
  inventoryUnpackedFiles,
  prepareProductionRuntime,
  prepareReleaseProject,
  releaseStagingPaths
} from "../../../../scripts/package-windows.mjs";

const execFileAsync = promisify(execFile);
const packagedInventoryPath = "release-inventory.json";
const mcpServerRuntimeSuffix = "/@ether/mcp-server/dist/index.js";

type ReleaseInventoryEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

export type LocalMcpClient = {
  client: Client;
  close(): Promise<void>;
};

/**
 * Opens the packaged application's published local MCP bridge through the
 * same stdio command a local Codex plugin uses. The descriptor is scoped to
 * the journey's isolated LOCALAPPDATA root.
 */
export async function openPackagedLocalMcpClient(
  workspaceRoot: string,
  localAppData: string
): Promise<LocalMcpClient> {
  const sourceMcpServerPath = path.join(workspaceRoot, "packages", "mcp-server", "dist", "index.js");
  await assertSourceMcpRuntimeMatchesPackagedCandidate(workspaceRoot, sourceMcpServerPath);
  const descriptorPath = path.join(localAppData, "DreamBay", "Ether", "mcp-session.json");
  await waitForFile(descriptorPath);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [sourceMcpServerPath],
    cwd: workspaceRoot,
    env: { ...getDefaultEnvironment(), ETHER_MCP_SESSION_DESCRIPTOR: descriptorPath },
    stderr: "pipe"
  });
  const client = new Client({ name: "ether-t21-packaged-journey", version: "4.0.0" });
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close().catch(() => undefined);
    }
  };
}

/**
 * The local Codex-plugin registration intentionally launches Node from the
 * workspace rather than from inside app.asar. Refuse to do that unless a
 * freshly staged production closure is byte-for-byte the packaged candidate.
 * This is the same fail-closed inventory proof used by the production T24
 * runner, with an additional direct check of the executable MCP entrypoint.
 */
async function assertSourceMcpRuntimeMatchesPackagedCandidate(
  workspaceRoot: string,
  sourceMcpServerPath: string
): Promise<void> {
  await access(sourceMcpServerPath);
  const packagedAsarPath = packagedAsarPathForWorkspace(workspaceRoot);
  await access(packagedAsarPath);
  const staging = releaseStagingPaths(workspaceRoot, `t21-mcp-runtime-${process.pid}`);
  try {
    await prepareProductionRuntime(workspaceRoot, { targetRoot: staging.runtimeRoot });
    const releaseProject = await prepareReleaseProject(workspaceRoot, staging);
    const currentInventory = await createStagedInventory(releaseProject);
    const packagedInventory = readPackagedInventory(packagedAsarPath);
    const actualPayload = inventoryAsarPayload(packagedAsarPath);
    const verified = assertPackagedInventoryMatches(packagedInventory, actualPayload.entries, {
      actualUnpackedEntries: await inventoryUnpackedFiles(packagedAsarPath),
      actualUnpackedPaths: actualPayload.unpackedPaths,
      expectedSourceInventory: currentInventory
    }) as { sourceEntries: ReleaseInventoryEntry[] };
    const stagedMcpEntry = findMcpServerRuntimeEntry(currentInventory.entries, "fresh staged runtime");
    const packagedMcpEntry = findMcpServerRuntimeEntry(verified.sourceEntries, "packaged candidate inventory");
    const sourceHash = createHash("sha256").update(await readFile(sourceMcpServerPath)).digest("hex");
    if (sourceHash !== stagedMcpEntry.sha256 || sourceHash !== packagedMcpEntry.sha256) {
      throw new Error("The source-built MCP server entrypoint differs from the exact packaged candidate runtime.");
    }
  } catch (error) {
    throw new Error(
      `T21 refuses to launch a source-built MCP runtime without exact packaged-runtime equivalence: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  } finally {
    await cleanupReleaseStaging(workspaceRoot, staging).catch(() => undefined);
  }
}

function packagedAsarPathForWorkspace(workspaceRoot: string): string {
  // The candidate executable may be relocated only as a complete win-unpacked
  // directory. Resolve app.asar relative to that directory rather than relying
  // on the MCP package's source-tree layout.
  return path.join(workspaceRoot, "release", "windows", "win-unpacked", "resources", "app.asar");
}

function readPackagedInventory(asarPath: string): unknown {
  try {
    return JSON.parse(extractFile(asarPath, packagedInventoryPath).toString("utf8"));
  } catch (error) {
    throw new Error(`The packaged candidate has no readable ${packagedInventoryPath}.`, { cause: error });
  }
}

function findMcpServerRuntimeEntry(entries: readonly ReleaseInventoryEntry[], label: string): ReleaseInventoryEntry {
  const matches = entries.filter((entry) => entry.path.replaceAll("\\", "/").endsWith(mcpServerRuntimeSuffix));
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one staged MCP server runtime entry; found ${matches.length}.`);
  }
  return matches[0]!;
}

/** Invoke an actual MCP tool and reject a structured server error. */
export async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (!("content" in result)) throw new TypeError(`Unexpected task-based MCP result for ${name}.`);
  if (result.isError === true) throw new Error(`MCP ${name} failed: ${JSON.stringify(result.structuredContent)}`);
  return record(result.structuredContent, `${name} result`);
}

/**
 * Drives the visible native Codex menu by keyboard (Alt+C, Enter), then
 * confirms both exact owner-scoped native permit dialogs through UIA.
 */
export async function grantEditPermitThroughNativeMenu(ownerPid: number): Promise<string> {
  if (process.platform !== "win32") throw new Error("Native Edit Permit approval is only available on Windows.");
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("Native Edit Permit approval requires one positive Ether PID.");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherT21NativeMenu { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$owners = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($owners.Count -ne 1) { throw ('Expected one exact packaged Ether owner window; found ' + $owners.Count) }",
    "$owner = $owners[0]; $ownerHwnd = [intptr]$owner.Current.NativeWindowHandle",
    "try { $owner.SetFocus() } catch {}; [EtherT21NativeMenu]::SetForegroundWindow($ownerHwnd) | Out-Null; Start-Sleep -Milliseconds 150",
    "if ([EtherT21NativeMenu]::GetForegroundWindow() -ne $ownerHwnd) { throw 'Exact packaged Ether window is not foreground for the Codex menu keyboard flow.' }",
    "[EtherT21NativeMenu]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [EtherT21NativeMenu]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero); [EtherT21NativeMenu]::keybd_event(0x43, 0, 2, [UIntPtr]::Zero); [EtherT21NativeMenu]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 120",
    "[EtherT21NativeMenu]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero); [EtherT21NativeMenu]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)",
    "Write-Output ('native-menu ownerPid=' + $ownerPid + ' shortcut=Alt+C,Enter')"
  ].join("; ");
  const { stdout } = await runPowerShell(script);
  const confirmation = await invokeExactOwnedNativeButtonWithUia(ownerPid, "Grant Edit Permit");
  const acknowledgement = await invokeExactOwnedNativeButtonWithUia(ownerPid, "OK");
  return [stdout.trim(), confirmation, acknowledgement].filter(Boolean).join(" | ");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

async function waitForFile(target: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await access(target);
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`The packaged Ether MCP bridge descriptor did not appear: ${target}`, { cause: lastError });
}

async function runPowerShell(script: string): Promise<{ stdout: string }> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], { windowsHide: true });
}
