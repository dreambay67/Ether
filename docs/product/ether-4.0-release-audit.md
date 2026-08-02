# Ether 4.0.0 Release Audit

> **REJECTED RELEASE CANDIDATE (2026-08-02):** A product-owner audit found that blank-canvas authoring exposes only Prompt and Image, while core selection, direct editing, graph commands, and module workflows remain incomplete. The historical green verdict below is retained as audit evidence but is withdrawn. Follow `ether-4.0-recovery-design-spec.md` and `ether-4.0-recovery-acceptance.md`.

Historical status: **release gate was incorrectly declared complete**

Audit date: 2026-07-31
Audited product release commit: `e881471e467ed52b3848e57540ea9c28f55c14f4`
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

The complete candidate was exercised from the exact detached product release
commit in
`<verification-root>\Phase-6-verify-15fac4f`, with a fresh dependency install and
disposable profile rooted at
`<verification-root>\Phase-6-verify-profile-15fac4f`:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass in 125.784 s; lockfile unchanged |
| Playwright browser bootstrap | Pass in 83.728 s; fresh browser cache |
| `pnpm run typecheck` | Pass in 251.674 s; all workspace projects |
| `pnpm run lint` | Pass in 10.782 s; zero warnings |
| `pnpm run test:unit` | Pass in 32.196 s; 18 files, 237 tests |
| `pnpm run test:integration` | Pass in 415.743 s; 34 files, 463 tests |
| `pnpm run test:smoke` | Pass in 38.284 s; 21 sequential Chromium journeys |
| `pnpm run test:performance` | Pass in 338.958 s; 9 Vitest and 4 browser checks |
| `pnpm run desktop:build` | Pass in 75.107 s |
| `pnpm run desktop:package:win` | Pass in 302.247 s; NSIS x64 installer |
| `pnpm run release:package:audit` | Pass in 78.991 s; 7 package-audit tests |
| `pnpm run test:packaged` | Pass in 33.118 s; 3 clean-profile installed-package journeys |
| `pnpm --filter @ether/codex-plugin validate` | Pass in 0.509 s |
| `pnpm run test:conformance:codex` | Pass in 84.367 s; 2 of 2 against reviewed CLI 0.144.2 |
| `pnpm run test:conformance:gemini` | Pass in 783.346 s; 8 of 8 protected paid calls from the exact packaged binary in a separately authorized operator invocation |
| `pnpm run test:conformance:antigravity` | Pass in 11.642 s; 2 retained-fallback contracts, live portion explicitly skipped |
| `pnpm run manual:capture` | Pass on unchanged direct reproduction in 44.0 s; 36 installed-release captures |
| `pnpm run manual:build` | Pass in 3.351 s; tagged PDF |
| `pnpm run manual:verify` | Pass in 6.453 s; 31 A4 tagged pages |

The final Gemini pass covered Nano Banana 2 at 1K, 2K with a reference, and 4K;
Nano Banana Pro at 1K, 2K, and 4K; Nano Banana 2 Lite at 1K; and a Nano Banana Pro
source-image edit. All eight accepted artifacts matched requested structural
dimensions and returned JPEG MIME and received a SHA-256 before import. Search and
Image Search remained absent. The runner is internally capped at eight images and
reported a conservative maximum estimate of `$1.129`.

Before the first successful exact gate, Phase 6 had accepted 49 generated images.
Two later controlled exact-package attempts each accepted three images before one
ambiguous Pro 1K request ended once by timeout and once by provider server error.
The first successful exact pass then accepted all eight planned images. A later
`900755a` exact-gate invocation accepted four images before a Pro 2K call exceeded
the former two-minute boundary. Ether correctly did not auto-retry any ambiguous
paid request. Commit `ee12091f10c7d712ebbff2cd7c6fb15af675f069` extends the
still-bounded high-resolution deadline to five minutes, and its separately
authorized full matrix accepted all eight planned images without retry or fallback.
The first `15fac4f` exact-gate matrix accepted five images before Google returned a
server error for the sixth request. Ether again stopped without retrying that
ambiguous paid request or launching the remaining two items. A separately
authorized operator invocation then accepted all eight planned images from the
unchanged exact package. Phase 6 therefore launched 92 paid generation requests
and accepted 88 images.
Every runner invocation was capped at eight images and remained within the
separately approved live-test spend ceiling.

All frozen installation, source tests, build, packaging, package acceptance,
manual capture, and manual verification used the disposable profile. Electron
`safeStorage` ciphertext is deliberately bound to the Windows/Electron user-data
profile: copying the credential envelope into the fresh profile failed closed
before any paid request. The live Gemini matrix therefore used the same exact
packaged binary with the already verified protected profile supplied explicitly
through the required `ETHER_GEMINI_CONFORMANCE_USER_DATA` launcher contract and
`--user-data-dir`. There was no plaintext-key readback, environment secret,
command-line secret, log secret, or implicit fallback.

The first hosted Windows CI run exposed two environment-specific release defects
after typecheck, lint, and unit tests passed. The runner presented its temporary
directory through an equivalent Windows 8.3 path alias, and the workflow selected
the floating pnpm 11 release instead of the reviewed 11.5.1 toolchain. Commit
`2bf2d86edf61e4c4081804d40acc23fd40255a09` now accepts a differing AppData spelling
only when `lstat` proves the same directory identity, continues to reject reparse
points, resolves configured cloud roots through the same native canonicalization
as document paths, kept the native probe bounded at eight seconds at that stage,
and pins pnpm
11.5.1 in both repository metadata and CI. The corrected full local gate passed
237 unit and 461 integration tests, including real fixed-volume, cloud-junction,
junction-retarget, recovery, and reparse-rejection cases.

The next hosted run exposed one narrower alias case: GitHub's Windows runner made
the same checked-out directory visible simultaneously through
`C:\Users\runneradmin\...` and `C:\Users\RUNNER~1\...`. Commit
`6666a7a39ff0a558625a0b23f9a6c5fbf1f8ed93` permits the alternate spelling only
when bigint `birthtimeNs`, device, and inode identity prove that every existing
directory is the same native object. Writer leases likewise hash the native
realpath for existing destinations. Reparse and symlink rejection, lexical
fallback for not-yet-created destinations, and fail-closed behavior remain.
Focused coverage passed 137 of 137 tests before the full 461-test integration
suite and the exact detached release gate above.

Hosted run `30594438443` then showed that one package-boundary unit test retained a
30-second build deadline on a slower runner. Commit
`73b3b1c6700018bc353c099aea8f5841d9bf7a06` raised only that test harness deadline
to 120 seconds. Hosted run `30594930802` passed typecheck, lint, and all unit tests,
then exposed remaining integration harness deadlines plus a real publication
classification edge: a verified export directory removed immediately before
helper acquisition surfaced `ETHER_EXPORT_DIRECTORY_OPEN` as a generic publication
failure. Commit `8cc1f40` maps that vanished-directory signal to the typed
`PATH_GRANT_CHANGED` failure and adds deterministic coverage; test-only hosted
deadlines are 120 seconds while strict performance budgets remain unchanged.
Commit `9c5d60549e67975f9416088af248b5c08d9b0d23` adds the explicit profile contract
above and its unit proof. Hosted run `30599775452` then exposed the last Windows
alias transition: a file's path changed spelling after creation, so its writer
lease and recovery journal could disagree across long and 8.3 names. One
non-performance logging heartbeat also observed 58.37 ms against a 50 ms
runner-jitter threshold. Commit `900755a7f9038a9219e351384d47d49381b828ab`
derives writer leases from the containing directory's native identity plus the
case-normalized basename, accepts a recovery-path alias only when regular-file
identity proves the same object, and raises only the non-performance heartbeat
guard to 100 ms. The strict performance suite is unchanged. Commit `ee12091`
then corrected the real high-resolution Gemini timeout described above.

Hosted run `30606644151` for `ee12091` passed frozen install, typecheck, lint,
237 unit tests, and all 462 integration tests. Its smoke command then failed all
21 journeys before browser launch because the clean hosted runner had no
Playwright Chromium executable; no product assertion ran. Commit
`7c4837a32518519f5643cd59be95c89d177c40a5` adds the same explicit Chromium
bootstrap used by the successful fresh local gate before hosted smoke, plus a
workflow-order contract. The focused contract suite passed 41 of 41 tests.

Hosted run `30607717035` then passed browser bootstrap, typecheck, lint, and all
237 unit tests before one of 462 integration tests exposed a real cold-start
location-probe boundary: the actual native fixed-volume classification reached
the former eight-second deadline and failed closed as `unknown`, while the
immediately warmed probe passed. Commit
`15fac4f040a3ba4b4b3e08ae0f19c9e2ffa0c610` raises the still-hard-bounded default
to 12 seconds and adds deterministic fake-timer proof that a nine-second cold
probe succeeds. The final product-owner gate at `e881471` passed the complete
unit suite, 476 integration tests, and 21 Chromium smoke journeys.

The destructive recovery suite previously passed all 15 hard-kill and
publication-boundary journeys. Performance validation preserved the frozen 16 KiB
document-format budget and completed the 500-item lifecycle in 102.103 seconds,
inside its declared bound.

## Windows package

Retained candidate artifacts:

| Artifact | SHA-256 |
|---|---|
| `release/windows/Ether-4.0.0-Setup.exe` | `0E78420EF5258F707FA1E68C68FA753149937771BF326DC0E8B8128D38DBEAED` |
| `release/windows/win-unpacked/Ether.exe` | `AD8489E8D5FAC5CED6C0923C569D062F1C5A3A3644FEFDF1464B78F69388DDFF` |
| `release/windows/win-unpacked/resources/app.asar` | `9579A9F479DC16AE92FB9D994AE74E14EDCA71446595AD3AC4A973FF597D3DBC` |
| `docs/product/ether-4.0-user-manual.pdf` | `FA7B514F5C6DE455A66EC47909EEF02C86C8B5B865D01A7DFFABC50CFC3BB849` |

The NSIS and Chromium PDF containers embed build metadata, so byte hashes can
change on a rebuild. Source, staged runtime closure, NSIS payload inventory,
installed captures, PDF structure, and rendered content are the reproducibility
contract. The capture manifest binds the retained manual to installer
`0E78420EF5258F707FA1E68C68FA753149937771BF326DC0E8B8128D38DBEAED`
and executable
`AD8489E8D5FAC5CED6C0923C569D062F1C5A3A3644FEFDF1464B78F69388DDFF`.
The retained installer, executable, and ASAR are byte-identical copies of the
exact product-owner audit artifacts. The manual passes the same structural and
rendered-content verifier used at the preceding release gate.

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

The reviewed release range from the Phase 5 baseline through the audited product
release commit covers 153 tracked paths. Diff, index, lockfile, package, and
generated-output review found:

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

## Final product-owner audit

Commit `e881471e467ed52b3848e57540ea9c28f55c14f4` is the final audited product
state. The pass concentrated on the first-run and daily creation journeys:

- New Image nodes select a genuinely discovered image provider and never bind to
  a simulation profile in production.
- Existing unavailable provider bindings remain explicit instead of silently
  impersonating another provider.
- Node and multi-node runs use a real two-step preview/start flow that identifies
  provider, model, work-item count, output dimensions, and warnings before work
  begins.
- Recipe insertion preserves focus, rejects stale asynchronous setup, and uses a
  responsive keyboard-accessible gallery.
- Canvas nodes remain visible after hydration and resizing, node runtime status
  prioritizes active work, and canvas resizing preserves the user's focal point.
- Large generated outputs are chunked and integrity-checked instead of failing at
  the document storage boundary.
- Save As verifies destination bytes as well as document identity, preventing a
  rematerialized or substituted destination from being accepted as the source.
- Windows drive and UNC roots retain rooted semantics during cloud-location
  classification, so an entire synchronized drive cannot be mistaken for a
  local fixed path because Ether happens to run from that drive.

The exact source gate passed typecheck, lint, the full unit suite, 476 integration
tests, and 21 Chromium smoke journeys. The exact Windows package then passed 7
package-audit checks and 3 installed-package acceptance journeys. Two Gemini image
requests were used during this audit, below the authorized cap of 12. The second
request completed through Ether and imported a 554.4 KiB JPEG into Artifact
Observatory; no ambiguous request was automatically retried.

The final installed-release manual contains 36 recaptured product views across 31
tagged A4 pages, 38 unique images, and 11 internal links. Representative full
workspace, Recipe Gallery, inspector, execution, review, and artifact views were
visually inspected for clipping, overlap, inaccessible controls, and misleading
states.

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

## Prior publication record

The audited product release commit
`15fac4f040a3ba4b4b3e08ae0f19c9e2ffa0c610` was pushed without force to
`refs/heads/feature/ether-4.0` after confirming the prior remote feature head
`7c4837a32518519f5643cd59be95c89d177c40a5` was its direct ancestor. Remote
`main` remained exactly
`4b3a80ed541e946c9c6aa04609d8b0ac70f3a0b7`.

GitHub Actions release-candidate run
[`30613249553`](https://github.com/dreambay67/Ether/actions/runs/30613249553)
completed successfully for the exact audited product. Frozen install, browser
bootstrap, typecheck, lint, unit, integration, smoke, desktop build, plugin
validation, Windows packaging, package audit, and installed-package acceptance
all passed. The workflow's authenticated-provider and destructive-chaos steps
were explicitly optional and skipped; the exact local gate supplies their required
release evidence. The documentation closeout changes only release evidence,
installed-release captures, the generated manual, and Task 29 checkboxes; the
product binary for that publication remained the exact-gated `15fac4f` build.

The final product-owner commit `e881471e467ed52b3848e57540ea9c28f55c14f4`
supersedes that candidate and is intended only for a non-force update of
`refs/heads/feature/ether-4.0`. Remote `main`, merge, tag, and GitHub Release
creation remain outside this audit.

Merge, tag, GitHub Release creation, and any change to remote `main` remain
unperformed and require a separate explicit release-owner decision.
