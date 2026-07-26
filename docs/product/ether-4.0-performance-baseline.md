# Ether 4.0 Performance Baseline

Captured on 2026-07-23 for the Ether 4.0 release candidate. This document is separate from `ether-4.0-baseline.md`, which remains the historical pre-4.0 repository baseline.

## Qualified Baseline Machine

- Operating system: Microsoft Windows 11 Home, 64-bit, version 10.0.26200, build 26200
- Processor: Intel Core i9-14900HX, 24 physical cores and 32 logical processors
- Memory: 31.7 GB visible RAM
- Workspace storage: NVMe HFS001TEJ9X125N, 954 GB, NTFS
- Node.js: 24.16.0
- pnpm: 11.5.1
- Electron: 43.1.1
- Power mode: normal local interactive workstation use

This is the release-qualification baseline, not a claim that lower-spec machines are unsupported. Hardware below this profile needs separate qualification before its timing results are represented as release evidence.

## Measurement Method

The exact public gate is:

```powershell
pnpm.cmd run test:performance
```

The final release evidence includes two consecutive passes of the exact default Playwright configuration: four tests on each pass, covering the real 1,000-node browser canvas, packaged-candidate freshness, clean-profile production Electron startup, and production Electron open/hydration/autosave. Browser tests used a production Vite build. Electron tests used production main, preload, and renderer output with no development server or `ETHER_RENDERER_URL`. Every Electron trial used a disposable clean `APPDATA`, `LOCALAPPDATA`, and Chromium user-data directory.

One warm-up launch was excluded, followed by three measured clean-profile launches. Startup completed only when the Start surface was visible and New/Open were enabled. The 1,000-node journey opened a real `.ether` document, observed the rendered graph, performed a real graph mutation through desktop IPC, and waited for Saving to return to Saved. Median, 95th percentile, and maximum are reported from all three measured trials; with three observations, the reported 95th percentile is the observed maximum.

## Release Budget Results

### Production Electron

| Journey | Measured trials (ms) | Median (ms) | p95 / max (ms) | Budget | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Clean-profile cold start to usable Start | 1569.027, 1163.962, 1827.236 | 1569.027 | 1827.236 | < 3000 ms | Pass |
| 1,000-node launch to hydrated canvas | 1762.221, 1715.886, 1630.189 | 1715.886 | 1762.221 | < 2000 ms | Pass |
| Document open mark | 45.900, 48.900, 47.400 | 47.400 | 48.900 | < 2000 ms | Pass |
| Graph hydration mark | 338.400, 334.500, 335.400 | 335.400 | 338.400 | < 2000 ms | Pass |
| Autosave through desktop IPC | 1088.600, 1102.800, 1103.100 | 1102.800 | 1103.100 | < 2000 ms | Pass |
| Autosave Saving-to-Saved maximum frame gap | 10.100, 10.100, 10.000 | 10.100 | 10.100 | < 50 ms | Pass |

Excluded warm-up observations were 1680.894 ms for cold start and 1741.589 ms for the 1,000-node wall-clock journey. Its internal warm-up marks were 46.100 ms document open, 340.600 ms graph hydration, 1110.200 ms autosave, and a 10.000 ms maximum Saving-to-Saved frame gap. No overlapping Long Task or individual/sustained frame gap at or above 50 ms was observed in any autosave trial. The immediately preceding exact default pass also passed 4/4, with a 1786.604 ms maximum cold start and 1768.794 ms maximum wall-clock hydration. The 1,000-node production gate explicitly requires both the median and the observed p95/maximum wall-clock hydration time to remain below 2000 ms across the default three measured trials.

The final installable package must repeat this Electron journey with `ETHER_PERFORMANCE_REQUIRE_PACKAGED=1`. That mode now rebuilds the exact production staging inventory and compares every renderer, main, shared, preload, workspace-package, official MCP SDK, Sharp/native, and transitive runtime file with the deterministic inventory embedded in `app.asar`; a missing, stale, or obsolete runtime dependency fails closed instead of silently accepting an old package. A focused regression changes `node_modules/@ether/application/dist/index.js` and proves the packaged candidate is rejected. The final fresh-package run is recorded with the packaging evidence.

### Large Canvas

The real 1,000-node canvas pan/zoom journey sampled 26 animation frames:

- Median frame gap: 16.700 ms
- Maximum frame gap: 16.800 ms
- Sustained or individual observed tasks over 50 ms: none
- Pure graph-to-canvas projection: 0.990 ms for 1,000 nodes and 999 edges

### Indexed Artifact Search And Asset Loading

- 10,000-artifact FTS query to first result: 2.311 ms against a real `.ether` document; budget under 200 ms
- Real Ether provider artifact: 377-byte original with a separately generated 206-byte WebP thumbnail
- Thumbnail response through the application and `ether-asset` protocol: 6.695 ms
- Requested 8-byte original range: 2.586 ms
- Off-screen/full original bytes read by those bounded requests: none

New image artifacts persist a bounded 320-pixel WebP companion blob and explicit content key, media type, and byte length. `ArtifactGrid` requests only `/thumbnail`; legacy artifacts without a valid thumbnail show an honest placeholder rather than silently decoding the original.

### Document Open And Autosave Core Path

The application-level real-document journey measured:

- Document inspection: 8.709 ms
- Raw transaction: 8.487 ms
- Bounded range read: 0.350 ms
- Application open to graph snapshot: 25.820 ms
- Application autosave transaction: 3.859 ms

The production Electron results above are authoritative for the user-visible budget because they include process, renderer, IPC, and React hydration.

### Provider And 500-Work-Item Lifecycle

The warm protocol test is deliberately labeled deterministic fake app-server transport evidence. It excludes product scheduler persistence and provider generation:

- Process startup and App Server initialization: 261.521 ms
- Queue: 0 ms
- Dispatch to the first real App Server notification: 15 ms
- Generation from first notification to completed turn: 0 ms
- Warm total: 15 ms; budget under 1000 ms

The real 500-work-item journey used `EtherApplication`, `DocumentStore`, `ExecutionRepository`, the durable scheduler, and the deterministic local image provider. It persisted, dispatched, imported, accepted, closed, and reopened all 500 work items and artifacts:

- Plan compilation: 200.150 ms
- Scheduler persistence: 3808.138 ms
- Queue to first provider dispatch: 8562.354 ms
- Provider dispatch to first provider event: 0.219 ms
- Provider generation from first event to output: 1.157 ms
- Provider output validation and durable staging, including bounded WebP thumbnail generation: 417.057 ms
- Durable artifact import and acceptance: 20.461 ms
- Full 500-item lifecycle: 112981.690 ms
- Read-only reopen and recovery queries: 420.954 ms
- Accepted artifacts after reopen: 500, with no missing or duplicate accepted work

Backend performance measures use numeric start/end timestamps and bounded retention. The run verified 500 finite, non-negative measures for each of queue, dispatch-to-first-event, generation, validation/staging, and import without shared-mark collisions. Providers report real event/generation/validation phases when their protocol exposes them; providers without an event stream do not fabricate a first event.

### Sparse Large-Asset Boundary

A real Windows sparse file with a 4,296,015,872-byte logical size (4 GiB plus 1 MiB) was used without allocating or reading the logical payload:

- Physically allocated range reported by Windows: 65,536 bytes at offset zero
- Explicit bounded tail read: 65,536 bytes in 0.262 ms
- Embedded import limit: 536,870,912 bytes
- Oversize rejection: 3.585 ms, before staging checkpoints
- Asset protocol stream invocations: 0

The gate fails closed if Windows sparse-file creation is unavailable. A non-Windows runner may skip only with the explicit `ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP=1` launch exception.

## Format Freeze

The complete benchmark exercised graph reads, artifact FTS, thumbnail reads, byte ranges, recipe reads, work-item reads, write cost, and file size at each SQLite page-size candidate:

| Page size | File bytes | Write (ms) | Complete read workload (ms) | Composite score |
| ---: | ---: | ---: | ---: | ---: |
| 4 KiB | 12,394,496 | 1073.547 | 3.496 | 1.278223 |
| 8 KiB | 13,279,232 | 1011.646 | 3.015 | 1.154956 |
| 16 KiB | 14,991,360 | 1038.554 | 2.661 | 1.094824 |
| 32 KiB | 18,644,992 | 1106.952 | 2.431 | 1.099197 |

Each displayed metric is now the median of seven independently created complete-workload databases. Candidate execution order is deterministically rotated and reversed between samples, so write timing is neither a single observation nor permanently biased by candidate order. The measured composite winner and frozen production page size were both 16 KiB. Ether therefore freezes 16 KiB rather than changing the document format in response to normal benchmark variation. Ether 4.0 also freezes application ID, format version 4.0.0, schema 40000, channels, roles, canonical nodes, graph/document transaction contracts, and recipe manifest through the exported format contract, golden fixtures, future-major refusal tests, read-only recovery fixtures, and the initial no-op 4.0-to-4.x migration harness.

## Production Bundle

The renderer is split at deliberate workspace boundaries. The largest production JavaScript chunks in this run were:

- Canvas workspace: 283.25 KiB
- Application shell: 225.66 KiB
- Ether graph/runtime: 139.93 KiB
- Artifact Browser: 42.36 KiB
- Job Center: 7.20 KiB
- Batch Matrix: 5.85 KiB

No JavaScript chunk exceeded Vite's 500 KiB warning threshold. The build retains the default warning threshold so future boundary regressions remain visible.

## Evaluation

The declared baseline passes every automated Ether 4.0 performance budget. The strongest next validation is the required clean-profile repeat against the freshly rebuilt installable Windows candidate, followed by a lower-spec Windows qualification run to establish a broader minimum hardware profile.
