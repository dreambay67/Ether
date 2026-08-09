# t14-worker-review action log

- Mode: packaged
- Outcome: passed
- Git commit: 9acd1bb81b7f21f6fd36af71158041a2e8ca00f2
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T22:29:54.705Z
- Finished: 2026-08-09T22:30:05.779Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 041d80aff7402348bd5aeae718f4784d4aa545efc597ae2b21b56e7918997023
- release/windows/win-unpacked/resources/app.asar: c604e44d467f7e4114bb02299bb218b48c4827fd9f394a70dead872e2d9d36bb

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 498). | 58 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 64 |  |
| 3 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 79 |  |
| 4 | left-click | Add generation.image from Node Library | The blank document creates generation.image through the canonical registry. | Left click at (108, 799). | 63 |  |
| 5 | left-click | Hide Reference Desk | The blank-authored recovery chain remains fully visible. | Left click at (1581, 151). | 76 |  |
| 6 | left-click | Hide Build tools | The blank-authored recovery chain remains fully visible. | Left click at (244, 183). | 64 |  |
| 7 | keyboard-command | Fit the Worker recovery chain | Prompt, both Workers, and Image Generator fit in one ordinary canvas view. | Pressed Home. | 6 |  |
| 8 | left-click | Focus Prompt content | The Prompt's primary content control owns keyboard focus. | Left click at (688, 693). | 44 |  |
| 9 | keyboard-command | Edit the authored Prompt | Enter opens the primary inline text editor through the focused card control. | Pressed Enter. | 31 |  |
| 10 | keyboard-command | Commit the authored Prompt | The durable Prompt becomes the sole starting material for the Worker chain. | Pressed Control+Enter. | 46 |  |
| 11 | left-click | Begin Prompt to Worker A | The compatible Text input receiver becomes the intended lane target. | Left click at (826, 633). | 35 |  |
| 12 | left-click | Complete Prompt to Worker A | The exact connection persists through the ordinary channel interaction. | Left click at (224, 408). | 253 |  |
| 13 | left-click | Begin Worker A to Worker B | The compatible Text input receiver becomes the intended lane target. | Left click at (501, 408). | 148 |  |
| 14 | left-click | Complete Worker A to Worker B | The exact connection persists through the ordinary channel interaction. | Left click at (549, 408). | 303 |  |
| 15 | left-click | Begin Worker B to Image Generator | The compatible Text input receiver becomes the intended lane target. | Left click at (826, 408). | 58 |  |
| 16 | left-click | Complete Worker B to Image Generator | The exact connection persists through the ordinary channel interaction. | Left click at (874, 408). | 242 |  |
| 17 | left-click | Inspect latest-approved lane 1 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (525, 521). | 51 |  |
| 18 | left-click | Inspect latest-approved lane 2 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (525, 408). | 56 |  |
| 19 | left-click | Inspect latest-approved lane 3 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (850, 408). | 69 |  |
| 20 | left-click | Select Worker A | The ordinary Inspector exposes the Worker profile and result-handling controls. | Left click at (363, 419). | 50 |  |
| 21 | left-click | Save Worker A review policy | The authored instruction, deterministic profile, and review policy save together through one normal Inspector action. | Left click at (1410, 567). | 72 |  |
| 22 | left-click | Select Worker B | The ordinary Inspector exposes the Worker profile and result-handling controls. | Left click at (688, 419). | 61 |  |
| 23 | left-click | Save Worker B review policy | The authored instruction, deterministic profile, and review policy save together through one normal Inspector action. | Left click at (1410, 567). | 66 |  |
| 24 | left-click | Select Image Generator | The ordinary Inspector exposes only verified image profiles. | Left click at (1013, 419). | 79 |  |
| 25 | left-click | Save deterministic Image Generator profile | The recovery-only fake-local image profile becomes the durable binding for this branch. | Left click at (1439, 661). | 71 |  |
| 26 | screenshot | Capture the blank-authored Worker chain | Prompt, two Workers, Image Generator, and three latest-approved lanes were created through ordinary UI input only. | Captured after the documented preceding action. | 243 | screenshots/01-authored-review-chain.png |
| 27 | left-click | Select Worker A for inspect-first execution | Worker A is configured to leave its durable result unreviewed. | Left click at (363, 419). | 53 |  |
| 28 | left-click | Preview Worker A plan | The deterministic Worker plan is reviewed before any permit is created. | Left click at (1407, 883). | 93 |  |
| 29 | left-click | Permit and start Worker A | Only the reviewed deterministic Worker plan receives its one-use permit. | Left click at (1401, 700). | 70 |  |
| 30 | left-click | Wait for Worker A durable job | Job Center displays the durable plan execution created through preview and permit. | Left click at (169, 89). | 154 |  |
| 31 | left-click | Return to the Build workspace | The Inspector refreshes Worker A's completed durable version. | Left click at (47, 89). | 45 |  |
| 32 | left-click | Inspect Worker A output | Worker A's exact output and provenance are visible before approval. | Left click at (363, 419). | 54 |  |
| 33 | left-click | Open Worker A provenance | Provider, job, and generated output lineage are inspectable before approval. | Left click at (1461, 893). | 56 |  |
| 34 | screenshot | Capture Worker A unreviewed output | The inspect-first result is durable, unreviewed, and visibly tied to the deterministic local simulation. | Captured after the documented preceding action. | 229 | screenshots/02-worker-a-unreviewed-provenance.png |
| 35 | left-click | Approve Worker A output | The durable output becomes eligible for the next latest-approved lane. | Left click at (1410, 723). | 43 |  |
| 36 | left-click | Select Worker B and the Image branch | Worker B retains its separately authored instruction and auto-apply policy. | Left click at (688, 419). | 73 |  |
| 37 | left-click | Preview approved Worker B image branch | The branch resolves only Worker A's approved result and the fake-local Image Generator before permit. | Left click at (1407, 741). | 90 |  |
| 38 | left-click | Permit and start Worker B with Image Generator | The previewed Worker B branch is explicitly permitted and started without a real provider or image call. | Left click at (1403, 700). | 246 |  |
| 39 | left-click | Wait for Worker B and Image Generator durable job | Job Center displays the durable plan execution created through preview and permit. | Left click at (169, 89). | 767 |  |
| 40 | left-click | Return to Build for transformed lineage | The completed branch output is inspected in the ordinary canvas workspace. | Left click at (47, 89). | 61 |  |
| 41 | left-click | Inspect Worker B transformed output | Worker B's auto-applied durable output preserves its selected approved input lineage. | Left click at (688, 419). | 57 |  |
| 42 | left-click | Open Worker B transformed provenance | The output identifies its selected input version instead of changing Worker B's authored instruction. | Left click at (1461, 893). | 61 |  |
| 43 | left-click | Inspect Image Generator output lineage | The generated image has the Worker B approved version as its selected input. | Left click at (1013, 419). | 94 |  |
| 44 | left-click | Open Image Generator provenance | The image output preserves the transformed Worker lineage through the latest-approved lane. | Left click at (1461, 832). | 86 |  |
| 45 | screenshot | Capture approved transformed lineage | Worker B auto-applies its valid output, Image Generator consumes that approved version, and Worker B's authored instruction remains unchanged. | Captured after the documented preceding action. | 218 | screenshots/03-approved-worker-and-image-lineage.png |
| 46 | observation | T14 practical slice | A blank-authored review-gated Worker chain can safely progress into a deterministic image branch. | Worker A produced an unreviewed durable version that was explicitly approved; Worker B then auto-applied a transformed version consumed by Image Generator through latest-approved lanes while retaining its own instruction. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
