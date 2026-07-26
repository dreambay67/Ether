export interface PerformanceGraphNodeFixture {
  id: string;
  position: { x: number; y: number };
  title: string;
}

export interface PerformanceArtifactFixture {
  id: string;
  title: string;
  description: string;
  ordinal: number;
}

export interface PerformanceWorkItemFixture {
  id: string;
  ordinal: number;
  status: "queued";
}

/** Fixed values make budget regressions comparable across CI and local runs. */
export function createThousandNodeFixture(): PerformanceGraphNodeFixture[] {
  return Array.from({ length: 1_000 }, (_value, index) => ({
    id: `node-${String(index).padStart(4, "0")}`,
    position: { x: (index % 40) * 280, y: Math.floor(index / 40) * 180 },
    title: `Performance node ${index}`
  }));
}

export function createTenThousandArtifactFixture(): PerformanceArtifactFixture[] {
  return Array.from({ length: 10_000 }, (_value, index) => ({
    id: `artifact-${String(index).padStart(5, "0")}`,
    title: `Campaign image ${index}`,
    description: index % 10 === 0 ? "featured campaign artifact" : "generated campaign artifact",
    ordinal: index
  }));
}

export function createFiveHundredWorkItemFixture(): PerformanceWorkItemFixture[] {
  return Array.from({ length: 500 }, (_value, index) => ({
    id: `work-item-${String(index).padStart(3, "0")}`,
    ordinal: index,
    status: "queued"
  }));
}
