import os from "node:os";
import path from "node:path";

export const RECOVERY_SHELL_IDENTITY_ARGUMENT = "--ether-recovery-shell-identity=";
export const RECOVERY_SHELL_CLEANUP_ARGUMENT = "--ether-recovery-shell-cleanup=";

export type RecoveryShellIdentity = {
  appUserModelId: string;
  cleanupOnly: boolean;
  taskbarName: string;
  token: string;
};

/**
 * Gives approval-gated packaged recovery journeys an AUMID that cannot group
 * with an installed Ether instance. The hook is accepted only for the exact
 * disposable profile shape allocated by the recovery journey driver.
 */
export function resolveRecoveryShellIdentity(input: {
  appData: string | undefined;
  argv: readonly string[];
  platform?: NodeJS.Platform;
  tempRoot?: string;
  userData: string;
}): RecoveryShellIdentity | null {
  const matches = input.argv.filter((argument) =>
    argument.startsWith(RECOVERY_SHELL_IDENTITY_ARGUMENT) || argument.startsWith(RECOVERY_SHELL_CLEANUP_ARGUMENT)
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error("Ether recovery shell identity requires exactly one scoped argument.");
  if ((input.platform ?? process.platform) !== "win32") throw new Error("Ether recovery shell identity is Windows-only.");

  const argument = matches[0]!;
  const cleanupOnly = argument.startsWith(RECOVERY_SHELL_CLEANUP_ARGUMENT);
  const token = argument.slice((cleanupOnly ? RECOVERY_SHELL_CLEANUP_ARGUMENT : RECOVERY_SHELL_IDENTITY_ARGUMENT).length);
  if (!/^[a-f0-9]{32}$/u.test(token)) throw new Error("Ether recovery shell identity token must be 32 lowercase hexadecimal characters.");
  if (input.appData === undefined) throw new Error("Ether recovery shell identity requires an isolated APPDATA path.");

  const userData = path.resolve(input.userData);
  const appData = path.resolve(input.appData);
  const profileRoot = path.dirname(path.dirname(appData));
  const tempRoot = path.resolve(input.tempRoot ?? os.tmpdir());
  const relativeProfile = path.relative(tempRoot, profileRoot);
  const relativeUserData = path.relative(profileRoot, userData);
  const relativeAppData = path.relative(profileRoot, appData);
  if (
    relativeProfile === "" || relativeProfile.startsWith("..") || path.isAbsolute(relativeProfile) ||
    !path.basename(profileRoot).startsWith("ether-recovery-journey-") ||
    relativeUserData === "" || relativeUserData.startsWith("..") || path.isAbsolute(relativeUserData) ||
    relativeAppData === "" || relativeAppData.startsWith("..") || path.isAbsolute(relativeAppData) ||
    path.basename(userData) !== "Ether-Recovery-Profile" ||
    path.basename(appData) !== "Roaming"
  ) {
    throw new Error("Ether recovery shell identity refused a non-disposable profile.");
  }

  return {
    appUserModelId: `com.dreambay.ether.recovery.${token}`,
    cleanupOnly,
    taskbarName: `Ether Recovery ${token.slice(0, 8)}`,
    token
  };
}
