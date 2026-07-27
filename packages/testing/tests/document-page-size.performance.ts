import { ETHER_PAGE_SIZE } from "@ether/document";
import {
  ETHER_PAGE_SIZE_STABILITY_TOLERANCE,
  benchmarkPageSizes,
  decideProductionPageSize
} from "@ether/document/benchmark/page-size";
import { describe, expect, it } from "vitest";

describe("Ether 4.0 page-size format freeze", () => {
  it("benchmarks all candidates and freezes the measured production page size", async () => {
    const results = await benchmarkPageSizes();
    expect(results.map((result) => result.pageSize)).toEqual([4_096, 8_192, 16_384, 32_768]);
    expect(results.every((result) => result.sampleCount === 7 && result.fileBytes > 0 && result.writeMs > 0 && result.elapsedMs >= 0 && result.graphReadMs >= 0 && result.artifactFtsMs >= 0 && result.thumbnailReadMs >= 0 && result.rangeReadMs >= 0 && result.recipeReadMs >= 0 && result.workItemReadMs >= 0)).toBe(true);
    expect(results.every((result) =>
      Object.values(result.sampleCounts).every((sampleCount) => sampleCount === result.sampleCount)
    )).toBe(true);
    const decision = decideProductionPageSize(results);
    expect(decision.productionPageSize).toBe(ETHER_PAGE_SIZE);
    expect(decision.productionDelta).toBeLessThanOrEqual(ETHER_PAGE_SIZE_STABILITY_TOLERANCE);
    expect(decision.tolerance).toBe(0.15);
    expect(decision.rationale).toMatch(/stable production format.*complete-workload composite/i);
    expect(Object.keys(decision.candidateScores)).toEqual(["4096", "8192", "16384", "32768"]);
    console.info(`ETHER_PERFORMANCE_METRIC document-page-size ${JSON.stringify({ results, decision })}`);
  });
});
