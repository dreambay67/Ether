import { describe, expect, it } from "vitest";

import {
  RECOVERY_WORKER_SIMULATION_CAPABILITIES,
  RECOVERY_WORKER_SIMULATION_MODEL_ID,
  RECOVERY_WORKER_SIMULATION_PROFILE_ID,
  RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
  createRecoveryWorkerSimulationFacets
} from "../../../apps/desktop/src/main/recoveryWorkerSimulation.js";

describe("recovery Worker simulation", () => {
  it("advertises one local, runtime-discovered LLM/interpret route", () => {
    expect(RECOVERY_WORKER_SIMULATION_CAPABILITIES).toHaveLength(2);
    expect(RECOVERY_WORKER_SIMULATION_CAPABILITIES.map((capability) => capability.operation)).toEqual(["llm", "interpret"]);
    expect(RECOVERY_WORKER_SIMULATION_CAPABILITIES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
        profileId: RECOVERY_WORKER_SIMULATION_PROFILE_ID,
        modelId: RECOVERY_WORKER_SIMULATION_MODEL_ID,
        provenance: "runtime-discovered",
        supportsCancellation: true
      })
    ]));
    expect(new Set(RECOVERY_WORKER_SIMULATION_CAPABILITIES.map((capability) =>
      `${capability.providerId}/${capability.profileId}/${capability.modelId}`
    ))).toEqual(new Set([`${RECOVERY_WORKER_SIMULATION_PROVIDER_ID}/${RECOVERY_WORKER_SIMULATION_PROFILE_ID}/${RECOVERY_WORKER_SIMULATION_MODEL_ID}`]));
  });

  it("is deterministic and only becomes executable when a caller requests its facets", async () => {
    const facets = createRecoveryWorkerSimulationFacets();
    const input = {
      workspacePath: "C:/recovery",
      runId: "run-1",
      assistantNodeId: "worker-1",
      assistantSubtype: "rewrite",
      prompt: "  Make  this  concise. ",
      instruction: " Preserve the product focus. ",
      notes: "",
      sections: [],
      references: [],
      edgeRoles: [],
      inputs: [{ channel: "text" as const, text: "  cobalt bottle  " }],
      requestedAt: "2026-08-09T12:00:00.000Z"
    };

    const [first, second] = await Promise.all([facets.worker.run(input), facets.worker.run(input)]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
      capabilities: ["assistant.text"],
      text: "[Ether recovery simulation: deterministic transformation]\nInstruction: Preserve the product focus.\nOutput: Make this concise.\nContext: cobalt bottle",
      metadata: { deterministic: true, simulation: "recovery", operation: "llm" }
    });
  });

  it("honors cancellation before either simulation facet produces output", async () => {
    const facets = createRecoveryWorkerSimulationFacets();
    const controller = new AbortController();
    controller.abort();
    let completed = false;

    await expect(facets.worker.run({
      workspacePath: "C:/recovery",
      runId: "run-1",
      assistantNodeId: "worker-1",
      assistantSubtype: "rewrite",
      prompt: "Transform this.",
      instruction: "Rewrite.",
      notes: "",
      sections: [],
      references: [],
      edgeRoles: [],
      requestedAt: "2026-08-09T12:00:00.000Z"
    }, {
      signal: controller.signal,
      providerAttemptId: "attempt-1",
      attemptOrdinal: 1,
      stagingDirectory: "C:/recovery/staging",
      complete: async () => { completed = true; }
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(facets.media.interpret({
      prompt: "Describe this.",
      inputs: [],
      signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(completed).toBe(false);
  });
});
