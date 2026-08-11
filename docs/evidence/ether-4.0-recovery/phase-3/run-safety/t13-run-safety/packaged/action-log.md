# t13-run-safety action log

- Mode: packaged
- Outcome: passed
- Git commit: 87153f61773b00f573007820ec151f4f525f61ec
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T07:46:32.342Z
- Finished: 2026-08-11T07:46:43.212Z

## Build identity

- release/windows/win-unpacked/Ether.exe: cf4639e8dfd14088ab93d1f3d25531d4418bf7324b53e04ef73bb9c758edfedd
- release/windows/win-unpacked/resources/app.asar: b1e6ed7a40deb5fcec6424d7b3d44dd87948b61e45e9034927c07939a14c51b6

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 498). | 75 |  |
| 2 | left-click | Add generation.image from Node Library | The blank document creates generation.image through the canonical registry. | Left click at (108, 799). | 65 |  |
| 3 | left-click | Add edit.image from Node Library | The blank document creates edit.image through the canonical registry. | Left click at (108, 662). | 64 |  |
| 4 | left-click | Add flow.batch from Node Library | The blank document creates flow.batch through the canonical registry. | Left click at (108, 662). | 53 |  |
| 5 | left-click | Hide Reference Desk | The authored run graph gets a clear practical viewport. | Left click at (1581, 151). | 61 |  |
| 6 | left-click | Hide Build tools | The authored run graph gets a clear practical viewport. | Left click at (244, 183). | 49 |  |
| 7 | keyboard-command | Fit the run-safety graph | All four blank-authored cards and their channel rails fit visibly. | Pressed Home. | 5 |  |
| 8 | left-click | Focus Prompt content | The Prompt's primary content control owns keyboard focus. | Left click at (1029, 690). | 40 |  |
| 9 | keyboard-command | Edit Prompt body | Enter opens the primary on-canvas editor without entering a provider workflow. | Pressed Enter. | 40 |  |
| 10 | keyboard-command | Commit Prompt body | The exact authored text becomes durable graph input. | Pressed Control+Enter. | 30 |  |
| 11 | left-click | Begin Prompt text to Image Generator | The compatible Text input handle becomes the intended receiver. | Left click at (1093, 666). | 41 |  |
| 12 | left-click | Complete Prompt text to Image Generator | The exact channel lane persists through the ordinary connection interaction. | Left click at (813, 538). | 262 |  |
| 13 | left-click | Begin Generated image to Image Editor | The compatible Image input handle becomes the intended receiver. | Left click at (942, 547). | 45 |  |
| 14 | left-click | Complete Generated image to Image Editor | The exact channel lane persists through the ordinary connection interaction. | Left click at (662, 420). | 280 |  |
| 15 | left-click | Begin Batch data to Image Generator | The compatible Data input handle becomes the intended receiver. | Left click at (640, 311). | 248 |  |
| 16 | left-click | Complete Batch data to Image Generator | The exact channel lane persists through the ordinary connection interaction. | Left click at (813, 566). | 282 |  |
| 17 | left-click | Select Image Generator | The Project lens exposes only verified provider profiles. | Left click at (878, 540). | 49 |  |
| 18 | left-click | Save Image Generator fake-local profile | The offline deterministic capability becomes the durable binding for this recovery-only run. | Left click at (1439, 568). | 79 |  |
| 19 | left-click | Select Image Editor | The Project lens exposes only verified provider profiles. | Left click at (726, 412). | 63 |  |
| 20 | left-click | Save Image Editor fake-local profile | The offline deterministic capability becomes the durable binding for this recovery-only run. | Left click at (1439, 230). | 69 |  |
| 21 | left-click | Select Batch | The progressive Inspector exposes the authored batch and its run scope. | Left click at (575, 284). | 61 |  |
| 22 | left-click | Add Batch dimension | A new Batch starts empty and exposes an ordinary control for its first dimension. | Left click at (1461, 333). | 64 |  |
| 23 | left-click | Save two Batch values | The exact two-item expansion is stored before preview. | Left click at (1406, 771). | 72 |  |
| 24 | screenshot | Capture the blank-authored run graph | Prompt, Batch, Image Generator, Image Editor, and three visible lanes were created only through ordinary UI input. | Captured after the documented preceding action. | 210 | screenshots/01-blank-authored-run-graph.png |
| 25 | left-click | Preview explicit Batch scope | The immutable Batch scope expands dimensions and downstream work without starting it. | Left click at (1513, 700). | 67 |  |
| 26 | left-click | Expand compiled Batch steps | Exact compiled inputs and provider bindings are reviewable before any permit exists. | Left click at (1461, 609). | 39 |  |
| 27 | screenshot | Capture immutable Batch preview | The prepared plan exposes scope, identity, provider settings, call count, concurrency, batch expansion, boundary, and compiled inputs. | Captured after the documented preceding action. | 179 | screenshots/02-immutable-batch-preview.png |
| 28 | left-click | Select Image Generator | The same authored graph exposes node, branch, and downstream scope choices. | Left click at (878, 540). | 35 |  |
| 29 | left-click | Preview Node scope | Node only predicts two generator calls because the upstream Batch has two values. | Left click at (1407, 741). | 77 |  |
| 30 | left-click | Preview Branch scope | Branch includes the selected generator and downstream editor for both Batch values. | Left click at (1407, 741). | 61 |  |
| 31 | left-click | Preview Downstream scope | Downstream excludes the root generator and predicts one editor call for each Batch value. | Left click at (1407, 741). | 42 |  |
| 32 | keyboard-command | Select the authored induced graph | All four UI-authored nodes become the Selected execution boundary. | Pressed Control+A. | 24 |  |
| 33 | keyboard-command | Preview Selected scope | The first shortcut press prepares the exact selected-node plan and does not run it. | Pressed Control+Enter. | 45 |  |
| 34 | screenshot | Capture Selected scope after Node, Branch, and Downstream previews | The blank-authored induced selection has its own inspect-first plan and remains unstarted. | Captured after the documented preceding action. | 153 | screenshots/03-scope-comparison.png |
| 35 | left-click | Dismiss Selected preview | The provider-safe comparison closes without starting the selected plan. | Left click at (312, 896). | 28 |  |
| 36 | left-click | Return to Image Generator | One small two-call fake-local job is isolated for the practical Job Center proof. | Left click at (878, 540). | 46 |  |
| 37 | left-click | Prepare two fake-local calls | The exact two-call Batch-expanded plan is reviewed before permission is granted. | Left click at (1407, 741). | 66 |  |
| 38 | left-click | Permit and start the reviewed plan | Only the displayed fake-local plan receives a one-use permit and starts. | Left click at (1403, 700). | 77 |  |
| 39 | left-click | Open Run workspace | Job Center hydrates the durable job created by the reviewed plan. | Left click at (169, 89). | 110 |  |
| 40 | left-click | Inspect authorized Job plan | Job Center shows the same immutable identity and exact plan after completion. | Left click at (1021, 910). | 431 |  |
| 41 | screenshot | Capture durable completed Job | The fake-local result is accepted and its immutable plan, attempt, timeline, and completion remain visible in Job Center. | Captured after the documented preceding action. | 339 | screenshots/04-job-center-result.png |
| 42 | observation | T13 practical slice | All five run scopes are inspect-first and one explicitly permitted offline job is durable. | Batch, Node, Branch, Downstream, and Selected previews were reviewed with their exact Batch-expanded call counts; only the final two-call fake-local Node plan started and completed with two accepted work items and two attempts. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| main-process | [72768:0811/094642.071:ERROR:content\browser\network_service_instance_impl.cc:721] Network service crashed or was terminated, restarting service. |
