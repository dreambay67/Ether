import os from "node:os";
import path from "node:path";

export const RECOVERY_SHELL_IDENTITY_ARGUMENT = "--ether-recovery-shell-identity=";
export const RECOVERY_SHELL_RECENT_ARGUMENT = "--ether-recovery-shell-recent=";
export const RECOVERY_SHELL_JOURNEY_ARGUMENT = "--ether-recovery-shell-journey=";
export const RECOVERY_SHELL_JUMP_LIST_JOURNEY = "a02-windows-jump-list";
const SHELL_UI_APPROVAL = "ETHER_A02_SHELL_UI_APPROVAL";
const SHELL_UI_APPROVAL_VALUE = "approved-by-main";
const ASSOCIATION_APPROVAL = "ETHER_A02_ASSOCIATION_MUTATION";
const ASSOCIATION_APPROVAL_VALUE = "approved-by-main";

export type RecoveryShellIdentity = {
  appUserModelId: string;
  /** Only the separately approved Jump List journey may opt into shell Recent APIs. */
  recentEnabled: boolean;
  taskbarName: string;
  token: string;
};

/**
 * Gives recovery journeys an AUMID that cannot group with an installed Ether
 * instance. Recent/Jump List integration is disabled by default: the distinct
 * recent flag is accepted only for the exact disposable profile shape allocated
 * by the recovery journey driver.
 */
export function resolveRecoveryShellIdentity(input: {
  appData: string | undefined;
  argv: readonly string[];
  environment?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  tempRoot?: string;
  userData: string;
}): RecoveryShellIdentity | null {
  const matches = input.argv.filter((argument) =>
    argument.startsWith(RECOVERY_SHELL_IDENTITY_ARGUMENT) || argument.startsWith(RECOVERY_SHELL_RECENT_ARGUMENT)
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error("Ether recovery shell identity requires exactly one scoped argument.");
  if ((input.platform ?? process.platform) !== "win32") throw new Error("Ether recovery shell identity is Windows-only.");

  const argument = matches[0]!;
  const recentEnabled = argument.startsWith(RECOVERY_SHELL_RECENT_ARGUMENT);
  const token = argument.slice((recentEnabled ? RECOVERY_SHELL_RECENT_ARGUMENT : RECOVERY_SHELL_IDENTITY_ARGUMENT).length);
  if (!/^[a-f0-9]{32}$/u.test(token)) throw new Error("Ether recovery shell identity token must be 32 lowercase hexadecimal characters.");
  if (recentEnabled) {
    const environment = input.environment ?? process.env;
    const journeyMarkers = input.argv.filter((value) => value.startsWith(RECOVERY_SHELL_JOURNEY_ARGUMENT));
    if (
      input.isPackaged !== true ||
      journeyMarkers.length !== 1 ||
      journeyMarkers[0] !== `${RECOVERY_SHELL_JOURNEY_ARGUMENT}${RECOVERY_SHELL_JUMP_LIST_JOURNEY}` ||
      environment[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE ||
      environment[ASSOCIATION_APPROVAL] !== ASSOCIATION_APPROVAL_VALUE
    ) {
      throw new Error("Ether recovery shell Recent mode requires the packaged approved Jump List journey and both explicit Windows shell approvals.");
    }
  }
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
    recentEnabled,
    taskbarName: `Ether Recovery ${token.slice(0, 8)}`,
    token
  };
}
