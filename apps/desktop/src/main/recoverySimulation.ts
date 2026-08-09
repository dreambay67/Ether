import type { ProviderCapability } from "@ether/schema";
import type { RecoveryShellIdentity } from "./recoveryShellIdentity.js";

export const RECOVERY_SIMULATION_ARGUMENT = "--ether-recovery-simulation=";

export const RECOVERY_SIMULATION_CAPABILITIES = [
  {
    providerId: "ether-fake-local",
    profileId: "fake-image-default",
    modelId: "deterministic-png-v1",
    operation: "generate-image",
    inputChannels: ["text", "image", "data"],
    outputChannels: ["image"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 32,
    maxOutputsPerCall: 32,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "runtime-discovered",
    limitations: ["Offline deterministic recovery simulation."]
  },
  {
    providerId: "ether-fake-local",
    profileId: "fake-image-default",
    modelId: "deterministic-png-v1",
    operation: "edit-image",
    inputChannels: ["text", "image", "mask", "data"],
    outputChannels: ["image"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 32,
    maxOutputsPerCall: 32,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "runtime-discovered",
    limitations: ["Offline deterministic recovery simulation."]
  }
] satisfies ProviderCapability[];

/**
 * Enables Ether's existing offline fake provider only inside a driver-owned
 * recovery profile. The matching recovery identity token prevents an ordinary
 * packaged launch from turning simulation on accidentally.
 */
export function resolveRecoverySimulation(input: {
  argv: readonly string[];
  recoveryShell: RecoveryShellIdentity | null;
}): boolean {
  const matches = input.argv.filter((argument) => argument.startsWith(RECOVERY_SIMULATION_ARGUMENT));
  if (matches.length === 0) return false;
  if (matches.length !== 1) throw new Error("Ether recovery simulation requires exactly one scoped argument.");
  if (input.recoveryShell === null) {
    throw new Error("Ether recovery simulation requires a disposable recovery profile identity.");
  }
  if (matches[0] !== `${RECOVERY_SIMULATION_ARGUMENT}${input.recoveryShell.token}`) {
    throw new Error("Ether recovery simulation token does not match the disposable profile identity.");
  }
  return true;
}
