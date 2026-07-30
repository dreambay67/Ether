# Ether 4.0.0 Release Audit

Status: **release candidate ready for exact-commit verification and publication**

Audit date: 2026-07-30
Candidate source commit: `5eedf81e4c1d50fcfcbf71f623dfe99cf2c51de5`
Audit baseline: `2cd4e9e1fe9e08d3ca43e8a0591b01e48073233c`
Required branch: `feature/ether-4.0-phase-6`
Publication branch: `feature/ether-4.0`

## Release scope

Ether 4.0.0 is a Windows desktop release built around a portable `.ether`
document, durable graph execution, real Codex workers, paid Gemini Developer API
image generation, explicit legacy Antigravity fallback, recovery, review, export,
and a permissioned Codex plugin.

The Google image route was migrated before this audit:

- `google-gemini-api-nano-banana-2`, `google-gemini-api-nano-banana-pro`, and
  `google-gemini-api-nano-banana-2-lite` are the normal Nano Banana profiles.
- `google-nano-banana-*` remains an explicit Antigravity CLI fallback. API errors
  never change a binding to that route.
- The Gemini key is accepted only by Electron main process and persisted only
  through Windows-backed Electron `safeStorage`; plaintext, environment, document,
  log, child-process, and IPC-readback fallbacks do not exist.
- Ether sends the documented Interactions API request with `store: false`, no
  Search or Image Search grounding, and JPEG output matching the live API.
- Nano Banana 2 exposes 0.5K/1K/2K/4K, Pro exposes 1K/2K/4K, and Lite exposes 1K.
  Returned MIME, exact dimensions, SHA-256, staging, and provenance are validated
  before durable import.

One app-wide concurrency domain enforces:

| Domain | Active-call limit |
|---|---:|
| All providers | 8 |
| Codex family | 4 |
| Gemini Developer API family | 4 |
| Explicit Antigravity fallback family | 4 |
| Unknown provider family | 1 |

Provider and global limits span schedulers, jobs, documents, and batches. A fifth
same-family call and ninth global call wait; large batches do not create unbounded
provider processes.

## Build environment

| Component | Reviewed version |
|---|---|
| Windows | Windows 11 Home, `10.0.26200` |
| Node.js | `24.16.0` |
| pnpm | `11.5.1`, frozen lockfile |
| Git | `2.55.0.windows.2` |
| Electron | `43.1.1` |
| electron-builder | `26.0.12` |
| Codex CLI | `0.144.2` reviewed release runtime |
| Gemini API | REST `v1beta` Interactions API; no bundled Google SDK |

The user-level Codex configuration currently names an unreviewed
`0.146.0-alpha.3.1` executable. Release conformance therefore used the preserved,
reviewed 0.144.2 executable through the supported `CODEX_CLI_PATH` override. Ether
fails the unreviewed route closed rather than silently accepting it.

Provider evidence remains in protected application data outside Git. It excludes
API keys, authentication files, account identifiers, prompts, responses, generated
images, executable paths, and personal paths.

## Provider and concurrency proof

Deterministic instrumentation and the full integration run prove:

| Requirement | Evidence |
|---|---|
| Four Codex plus four Gemini calls overlap | `batch-scheduler.test.ts` waits for eight active executor claims and asserts `codex = 4`, `gemini-api = 4`, and `global = 8`. |
| Fifth family and ninth global work queue | Dispatch counters remain at four per family and eight globally until a held claim releases. |
| Independent batches share capacity | Two scheduler instances and four jobs use one shared `ExecutionConcurrencyDomains` instance. |
| Prompt Worker exact allocation | Two exact four-item lanes persist provider, profile, model, effective parallelism 8, and stable plan hashing. |
| Image Generator exact allocation | Two exact four-item lanes persist provider, profile, model, size, ratio, output format, effective parallelism 8, and stable plan hashing. |
| Unknown providers fail closed | An unknown route advertising 99 resolves to 1. |
| Cancellation, retry, and recovery are repeat-safe | Wait cancellation preserves active siblings, duplicate retry creates no extra claim, and the 500-item recovery proof accepts each output exactly once. |
| UI states the policy honestly | The Chromium journey verifies separate `Full batch`, `Provider and model allocation`, and `Concurrent run` groups plus visible 4/4/8 copy. |

Gemini-specific unit and integration coverage also proves credential protection,
capability-aware recipes and Batch Matrix allocations, historical binding
normalization, bounded source/reference input, unique staging, collision
verification, cancellation cleanup, redacted failures, and no automatic provider
substitution.

## Candidate release gate

The complete candidate was exercised after the migration and reviewed fixes:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass; lockfile unchanged |
| `pnpm run typecheck` | Pass; all workspace projects |
| `pnpm run lint` | Pass; zero warnings |
| `pnpm run test:unit` | Pass; 18 files, 237 tests |
| `pnpm run test:integration` | Pass; 34 files, 461 tests |
| `pnpm run test:smoke` | Pass; 21 sequential Chromium journeys |
| `pnpm run test:performance` | Pass; 9 Vitest and 4 browser checks |
| `pnpm run desktop:build` | Pass |
| `pnpm run desktop:package:win` | Pass; NSIS x64 installer |
| `pnpm run release:package:audit` | Pass; 7 package-audit tests |
| `pnpm run test:packaged` | Pass; 3 clean-profile installed-package journeys |
| `pnpm --filter @ether/codex-plugin validate` | Pass |
| `pnpm run test:conformance:codex` | Pass; 2 of 2 against reviewed CLI 0.144.2 |
| `pnpm run test:conformance:gemini` | Pass; 8 of 8 protected paid calls |
| `pnpm run test:conformance:antigravity` | Pass; 2 retained-fallback contracts, live portion explicitly skipped |
| `pnpm run manual:capture` | Pass; 36 installed-release captures |
| `pnpm run manual:build` | Pass; tagged PDF |
| `pnpm run manual:verify` | Pass; 31 A4 tagged pages |

The final Gemini pass covered Nano Banana 2 at 1K, 2K with a reference, and 4K;
Nano Banana Pro at 1K, 2K, and 4K; Nano Banana 2 Lite at 1K; and a Nano Banana Pro
source-image edit. All eight accepted artifacts matched requested structural
dimensions and returned JPEG MIME and received a SHA-256 before import. Search and
Image Search remained absent. The runner is internally capped at eight images and
reported a conservative maximum estimate of `$1.129`.

One immediately preceding controlled run accepted seven images before Google
returned a server error for the final Pro edit. Ether correctly did not retry an
ambiguous paid operation. That run exposed an exit-status defect in the conformance
bootstrap; the bootstrap and runner were fixed, repackaged, and then proved by the
8-of-8 pass. The migration session used 10 generated images before the quota reset;
the final candidate work used 15 after the reset, for 25 generated images across the
migration and Phase 6 candidate validation to this point.

The destructive recovery suite previously passed all 15 hard-kill and
publication-boundary journeys. Performance validation preserved the frozen 16 KiB
document-format budget and completed the 500-item lifecycle in about 99.2 seconds,
inside its declared bound.

## Windows package

Retained candidate artifacts:

| Artifact | SHA-256 |
|---|---|
| `release/windows/Ether-4.0.0-Setup.exe` | `F6114DC4E9A87DE2C772E000E70241FEC429AE475AAB19425D43935333E2B9D5` |
| `release/windows/win-unpacked/Ether.exe` | `3B20A510DA722E08836B6EF653D5A9FA3642B489F222B5C749882D547A4832CC` |
| `release/windows/win-unpacked/resources/app.asar` | `AD2ADFF74276356A98709C04B6CA2A036E010470B821ACE178B87D089E0C1280` |
| `docs/product/ether-4.0-user-manual.pdf` | `5FFFA4BF4EA5DB1829AF10E1A260FDE7A5094AA85CA7312C0828CD217026E91A` |

The NSIS and Chromium PDF containers embed build metadata, so byte hashes can
change on a rebuild. Source, staged runtime closure, NSIS payload inventory,
installed captures, PDF structure, and rendered content are the reproducibility
contract. The capture manifest binds the manual to installer
`F6114DC4E9A87DE2C772E000E70241FEC429AE475AAB19425D43935333E2B9D5`
and executable
`3B20A510DA722E08836B6EF653D5A9FA3642B489F222B5C749882D547A4832CC`.

The package audit recorded:

- 2,103 ASAR paths and 1,637 packed files
- 40 unpacked native files
- 1,724 staged files, with identical first and repeat inventory hashes
- exact NSIS payload agreement with the unpacked runtime
- no tests, fixtures, benchmarks, TypeScript sources, source maps, caches,
  credentials, authentication data, generated Ether projects, or personal paths

Required third-party license and native notices are retained.
`@hono/node-server@2.0.12` is a reviewed compatibility override for MCP SDK
1.29.0; `fast-uri@3.1.4` remains within AJV's declared range. The frozen lockfile
did not change during the Gemini migration, and no Google SDK dependency was added.
The production dependency advisory audit is green.

## Source, privacy, and repository audit

The reviewed release range from the Phase 5 baseline plus this audit covers 141
tracked paths. Diff, index, lockfile, package, and generated-output review found:

- no API key, token, credential, authentication record, private key, or real bearer
  value
- no new personal path or user identifier
- no generated Ether project, provider response, staging output, cache, test result,
  or release directory tracked
- no new dependency or license obligation from the Gemini route
- no executable-bit change, symlink, submodule, or LFS pointer

One secret-shaped test match is an intentional fake fixture used to verify
redaction. Historical user-specific path examples predating the Phase 6 baseline
remain in source history; Phase 6 adds none, the package contains none, and Task 29
forbids rewriting unrelated history.

The repository and first-party package manifests do not declare an open-source
license. The Codex plugin declares `UNLICENSED`. Publication preserves that
proprietary posture and grants no open-source license.

## Manual acceptance

The installed-release manual verifier reports:

- 31 tagged A4 pages
- 36 installed-release captures
- 38 unique PDF images
- 11 working internal links
- no clipping, blank text page, replacement glyph, attachment, personal path, or
  credential-shaped text

Visual review covered the settings/Gemini credential surface, Batch Matrix,
Provider Health, representative inspector pages, package/hash page, and final
pages. Settings shows the complete Connect/Test/Remove surface and the statement
that Google billing is authoritative; no key is present. The Batch Matrix keeps
the three allocation/control groups separate and legible.

## Known limitations

- Windows binaries are unsigned; Windows can show SmartScreen or publisher-trust
  warnings.
- First-party manifests do not state an open-source license.
- NSIS and Chromium PDF containers are not byte-reproducible because they embed
  build metadata.
- The current user-level Codex path selects an unreviewed alpha; Ether leaves that
  route unavailable unless the reviewed 0.144.2 executable is selected.
- Antigravity is a retained explicit fallback, not the default Nano Banana route.
  Its live generation test is intentionally outside the launch gate.
- Merge, tag, GitHub Release, and changes to remote `main` are deliberately outside
  Task 29 and require a separate release-owner decision.

## Publication record

Pending exact-release-commit verification in a fresh worktree/profile, safe remote
ancestry validation, non-force push to `refs/heads/feature/ether-4.0`, and remote
tree/Actions verification. Those operations do not modify this audited release
commit.
