# Ether 4.0 Gemini Developer API review

Reviewed: 2026-07-30. This record is intentionally source-only: it contains no account identifier, API key, prompt, image, response, or user path.

## Reviewed official surface

- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation), Google documentation updated 2026-07-16: `POST https://generativelanguage.googleapis.com/v1beta/interactions`; `x-goog-api-key`; image input blocks; `response_format`; exact ratio and pixel tables; SynthID; reference guidance.
- [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview): GA Interactions API is the recommended new-project surface. Ether sends `store: false`.
- [Interactions API reference](https://ai.google.dev/api/interactions-api): the output-specific `ImageResponseFormat.mime_type` enum contains only `image/jpeg`. Separate generic image-content enums include PNG for image blocks, including inputs; those enums do not establish PNG as a supported `response_format` output.
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing): paid standard-tier image-output estimates, reviewed on the date above.
- [Gemini 3.1 Flash Image model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image): model availability and image capabilities.

Ether speaks the documented REST API directly with Node's built-in `fetch`; no Google SDK package is bundled. Reviewed API version: `v1beta`; SDK/library version: not applicable (no SDK dependency).

## Product mapping and honest controls

| Ether profile | Official model | Structural image sizes | Ratios |
|---|---|---|---|
| Nano Banana 2 | `gemini-3.1-flash-image` | 0.5K, 1K, 2K, 4K | 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9 |
| Nano Banana Pro | `gemini-3-pro-image` | 1K, 2K, 4K | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | 1K | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 |

The app validates both the requested structural pixel dimensions and the returned image MIME, dimensions, and SHA-256 before import. Google's image-generation guide currently contains some JavaScript/REST snippets that set `response_format.mime_type` to `image/png`; however, the same site's canonical Interactions `ImageResponseFormat` schema enumerates only `image/jpeg`. Paid preflights on 2026-07-30 resolved that contradiction against the live service: explicit `image/png` was rejected before generation with JPEG as the sole supported value, while omitting the MIME override returned JPEG bytes. The final recheck after the documentation review also failed before generating an image, so it did not consume the user's image allowance. Ether therefore exposes JPEG only for this Developer API route; it neither mislabels JPEG bytes nor performs or implies a PNG conversion. Gemini documents SynthID on all generated images.

Reference controls are conservative total-image lanes: Lite allows up to 14 image inputs, Flash up to 10 (with separate character guidance), and Pro up to 6 (with separate character/style guidance). For editing, the source, optional mask, and distinct references share that total; duplicate paths are sent once. Ether also caps decoded image inputs at 100 MB per request before base64 encoding. A mask remains guidance and is not represented as a promised pixel-exact native edit.

## Cost guidance

These are standard-tier output estimates in USD per image, not a billing record and not a spending authorization. Text/image input and model reasoning may add cost. Google Search/Image grounding can result in billable search requests, so Ether sends no tools and exposes no hidden grounding toggle.

| Profile | 0.5K | 1K | 2K | 4K |
|---|---:|---:|---:|---:|
| Nano Banana 2 | $0.045 | $0.067 | $0.101 | $0.151 |
| Nano Banana Pro | — | $0.134 | $0.134 | $0.240 |
| Nano Banana 2 Lite | — | $0.0336 | — | — |

The asynchronous Batch API is a future cost-saving option only. Ether's interactive durable route does not use it or silently change a user request into a batch request.

## Paid live conformance result

The protected live run passed eight representative calls: Nano Banana 2 at 1K, 2K with a reference, and 4K; Nano Banana Pro at 1K, 2K, and 4K; Nano Banana 2 Lite at 1K; and a Nano Banana Pro source-image edit. Every accepted artifact matched the requested structural dimensions and the returned JPEG MIME and had a recorded SHA-256. Search and Image Search grounding remained off. The run generated eight images; together with two earlier format probes, the migration session generated 10 images. Each repeatable conformance invocation has its own conservative eight-image guard. The scenario estimate was $0.9946 and the conservative maximum was $1.129, both estimates rather than billing records and below the separately approved live integration-test spend ceiling.

## Security and recovery contract

- Key entry is one protected renderer-to-main IPC write. The renderer receives state only: not configured, configured, verified, needs replacement, or encryption unavailable.
- Electron `safeStorage` is required. On Windows it uses OS-backed protection; unavailable protection fails closed. The persistent envelope contains encrypted bytes and a verification timestamp, never plaintext.
- The key is not read from an environment variable, passed to child processes, stored in documents/logs/crash evidence/screenshots/packages/tests/Git, or returned by any IPC channel.
- 401/403, billing/prepay, 429 quota, safety, network, 5xx, timeout, cancellation, malformed output, and ambiguous completion have separate redacted failure codes. Only one bounded `Retry-After` retry after a 429 is allowed; no completed/ambiguous request is retried automatically.
- `google-gemini-api-*` is route-distinct and primary. Existing `google-nano-banana-*` document bindings remain Antigravity fallback bindings, preserving explicit historical choices. No error triggers provider substitution.
- The whole application remains bounded at eight active calls. Gemini API profiles share four calls across all documents, jobs, and batches; Codex shares four; Antigravity remains separately bounded at four only when explicitly selected; unknown routes remain at one.
