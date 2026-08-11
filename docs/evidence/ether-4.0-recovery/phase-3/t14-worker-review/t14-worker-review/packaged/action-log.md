# t14-worker-review action log

- Mode: packaged
- Outcome: passed
- Git commit: 87153f61773b00f573007820ec151f4f525f61ec
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T07:46:51.510Z
- Finished: 2026-08-11T07:47:02.092Z

## Build identity

- release/windows/win-unpacked/Ether.exe: cf4639e8dfd14088ab93d1f3d25531d4418bf7324b53e04ef73bb9c758edfedd
- release/windows/win-unpacked/resources/app.asar: b1e6ed7a40deb5fcec6424d7b3d44dd87948b61e45e9034927c07939a14c51b6

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 498). | 62 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 66 |  |
| 3 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 55 |  |
| 4 | left-click | Add generation.image from Node Library | The blank document creates generation.image through the canonical registry. | Left click at (108, 799). | 53 |  |
| 5 | left-click | Hide Reference Desk | The blank-authored recovery chain remains fully visible. | Left click at (1581, 151). | 64 |  |
| 6 | left-click | Hide Build tools | The blank-authored recovery chain remains fully visible. | Left click at (244, 183). | 47 |  |
| 7 | keyboard-command | Fit the Worker recovery chain | Prompt, both Workers, and Image Generator fit in one ordinary canvas view. | Pressed Home. | 5 |  |
| 8 | left-click | Focus Prompt content | The Prompt's primary content control owns keyboard focus. | Left click at (1029, 690). | 41 |  |
| 9 | keyboard-command | Edit the authored Prompt | Enter opens the primary inline text editor through the focused card control. | Pressed Enter. | 54 |  |
| 10 | keyboard-command | Commit the authored Prompt | The durable Prompt becomes the sole starting material for the Worker chain. | Pressed Control+Enter. | 32 |  |
| 11 | left-click | Begin Prompt to Worker A | The compatible Text input receiver becomes the intended lane target. | Left click at (1093, 666). | 43 |  |
| 12 | left-click | Complete Prompt to Worker A | The exact connection persists through the ordinary channel interaction. | Left click at (813, 538). | 276 |  |
| 13 | left-click | Begin Worker A to Worker B | The compatible Text input receiver becomes the intended lane target. | Left click at (942, 538). | 45 |  |
| 14 | left-click | Complete Worker A to Worker B | The exact connection persists through the ordinary channel interaction. | Left click at (662, 410). | 280 |  |
| 15 | left-click | Begin Worker B to Image Generator | The compatible Text input receiver becomes the intended lane target. | Left click at (791, 410). | 50 |  |
| 16 | left-click | Complete Worker B to Image Generator | The exact connection persists through the ordinary channel interaction. | Left click at (511, 282). | 275 |  |
| 17 | left-click | Inspect latest-approved lane 1 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (953, 756). | 50 |  |
| 18 | left-click | Inspect latest-approved lane 2 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (802, 628). | 44 |  |
| 19 | left-click | Inspect latest-approved lane 3 | Each freshly authored lane is explicitly verified as latest-approved. | Left click at (651, 501). | 42 |  |
| 20 | left-click | Select Worker A | The ordinary Inspector exposes the Worker profile and result-handling controls. | Left click at (878, 540). | 46 |  |
| 21 | left-click | Save Worker A review policy | The authored instruction, deterministic profile, and review policy save together through one normal Inspector action. | Left click at (1410, 567). | 79 |  |
| 22 | left-click | Select Worker B | The ordinary Inspector exposes the Worker profile and result-handling controls. | Left click at (726, 412). | 59 |  |
| 23 | left-click | Save Worker B review policy | The authored instruction, deterministic profile, and review policy save together through one normal Inspector action. | Left click at (1410, 567). | 74 |  |
| 24 | left-click | Select Image Generator | The ordinary Inspector exposes only verified image profiles. | Left click at (575, 284). | 72 |  |
| 25 | left-click | Save deterministic Image Generator profile | The recovery-only fake-local image profile becomes the durable binding for this branch. | Left click at (1439, 661). | 67 |  |
| 26 | screenshot | Capture the blank-authored Worker chain | Prompt, two Workers, Image Generator, and three latest-approved lanes were created through ordinary UI input only. | Captured after the documented preceding action. | 231 | screenshots/01-authored-review-chain.png |
| 27 | left-click | Select Worker A for inspect-first execution | Worker A is configured to leave its durable result unreviewed. | Left click at (878, 540). | 38 |  |
| 28 | left-click | Preview Worker A plan | The deterministic Worker plan is reviewed before any permit is created. | Left click at (1407, 883). | 90 |  |
| 29 | left-click | Permit and start Worker A | Only the reviewed deterministic Worker plan receives its one-use permit. | Left click at (1401, 700). | 56 |  |
| 30 | left-click | Wait for Worker A durable job | Job Center displays the durable plan execution created through preview and permit. | Left click at (169, 89). | 139 |  |
| 31 | left-click | Return to the Build workspace | The Inspector refreshes Worker A's completed durable version. | Left click at (47, 89). | 47 |  |
| 32 | left-click | Inspect Worker A output | Worker A's exact output and provenance are visible before approval. | Left click at (878, 540). | 58 |  |
| 33 | left-click | Open Worker A provenance | Provider, job, and generated output lineage are inspectable before approval. | Left click at (1461, 893). | 48 |  |
| 34 | screenshot | Capture Worker A unreviewed output | The inspect-first result is durable, unreviewed, and visibly tied to the deterministic local simulation. | Captured after the documented preceding action. | 215 | screenshots/02-worker-a-unreviewed-provenance.png |
| 35 | left-click | Approve Worker A output | The durable output becomes eligible for the next latest-approved lane. | Left click at (1410, 723). | 47 |  |
| 36 | left-click | Select Worker B and the Image branch | Worker B retains its separately authored instruction and auto-apply policy. | Left click at (726, 412). | 55 |  |
| 37 | left-click | Preview approved Worker B image branch | The branch resolves only Worker A's approved result and the fake-local Image Generator before permit. | Left click at (1407, 741). | 86 |  |
| 38 | left-click | Permit and start Worker B with Image Generator | The previewed Worker B branch is explicitly permitted and started without a real provider or image call. | Left click at (1403, 700). | 52 |  |
| 39 | left-click | Wait for Worker B and Image Generator durable job | Job Center displays the durable plan execution created through preview and permit. | Left click at (169, 89). | 570 |  |
| 40 | left-click | Return to Build for transformed lineage | The completed branch output is inspected in the ordinary canvas workspace. | Left click at (47, 89). | 237 |  |
| 41 | left-click | Inspect Worker B transformed output | Worker B's auto-applied durable output preserves its selected approved input lineage. | Left click at (726, 412). | 50 |  |
| 42 | left-click | Open Worker B transformed provenance | The output identifies its selected input version instead of changing Worker B's authored instruction. | Left click at (1461, 893). | 48 |  |
| 43 | left-click | Inspect Image Generator output lineage | The generated image has the Worker B approved version as its selected input. | Left click at (575, 284). | 47 |  |
| 44 | left-click | Open Image Generator provenance | The image output preserves the transformed Worker lineage through the latest-approved lane. | Left click at (1461, 832). | 52 |  |
| 45 | screenshot | Capture approved transformed lineage | Worker B auto-applies its valid output, Image Generator consumes that approved version, and Worker B's authored instruction remains unchanged. | Captured after the documented preceding action. | 226 | screenshots/03-approved-worker-and-image-lineage.png |
| 46 | observation | T14 practical slice | A blank-authored review-gated Worker chain can safely progress into a deterministic image branch. | Worker A produced an unreviewed durable version that was explicitly approved; Worker B then auto-applied a transformed version consumed by Image Generator through latest-approved lanes while retaining its own instruction. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| main-process | [70280:0811/094701.012:ERROR:content\browser\network_service_instance_impl.cc:721] Network service crashed or was terminated, restarting service. |
