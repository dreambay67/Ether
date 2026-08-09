# t13-run-safety action log

- Mode: packaged
- Outcome: passed
- Git commit: 2e2d71bf447f6c35f5cbe8f112965368cbff5884
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T10:15:42.492Z
- Finished: 2026-08-09T10:15:53.787Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 3b4dac9e451cabe78e44c5b328587388e383b81f72c1d67aa97dc95daaed5bc8
- release/windows/win-unpacked/resources/app.asar: 2f729c84d8b16bc1b923b78819f0d99219dbbabd4e4cdc7b2ce597367ba652ae

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 498). | 88 |  |
| 2 | left-click | Add generation.image from Node Library | The blank document creates generation.image through the canonical registry. | Left click at (108, 799). | 76 |  |
| 3 | left-click | Add edit.image from Node Library | The blank document creates edit.image through the canonical registry. | Left click at (108, 662). | 79 |  |
| 4 | left-click | Add flow.batch from Node Library | The blank document creates flow.batch through the canonical registry. | Left click at (108, 662). | 75 |  |
| 5 | left-click | Hide Reference Desk | The authored run graph gets a clear practical viewport. | Left click at (1581, 151). | 50 |  |
| 6 | left-click | Hide Build tools | The authored run graph gets a clear practical viewport. | Left click at (244, 183). | 39 |  |
| 7 | keyboard-command | Fit the run-safety graph | All four blank-authored cards and their channel rails fit visibly. | Pressed Home. | 4 |  |
| 8 | left-click | Select Prompt for direct editing | The blank Prompt becomes the canvas editing target. | Left click at (688, 644). | 36 |  |
| 9 | keyboard-command | Edit Prompt body | The primary on-canvas editor opens without entering a provider workflow. | Pressed Enter. | 33 |  |
| 10 | keyboard-command | Commit Prompt body | The exact authored text becomes durable graph input. | Pressed Control+Enter. | 62 |  |
| 11 | left-click | Begin Prompt text to Image Generator | The compatible Text input handle becomes the intended receiver. | Left click at (826, 633). | 30 |  |
| 12 | left-click | Complete Prompt text to Image Generator | The exact channel lane persists through the ordinary connection interaction. | Left click at (224, 408). | 287 |  |
| 13 | left-click | Begin Generated image to Image Editor | The compatible Image input handle becomes the intended receiver. | Left click at (501, 437). | 44 |  |
| 14 | left-click | Complete Generated image to Image Editor | The exact channel lane persists through the ordinary connection interaction. | Left click at (549, 437). | 273 |  |
| 15 | left-click | Begin Batch data to Image Generator | The compatible Data input handle becomes the intended receiver. | Left click at (1151, 494). | 227 |  |
| 16 | left-click | Complete Batch data to Image Generator | The exact channel lane persists through the ordinary connection interaction. | Left click at (224, 494). | 287 |  |
| 17 | left-click | Select Image Generator | The Project lens exposes only verified provider profiles. | Left click at (363, 419). | 49 |  |
| 18 | left-click | Save Image Generator fake-local profile | The offline deterministic capability becomes the durable binding for this recovery-only run. | Left click at (1439, 568). | 68 |  |
| 19 | left-click | Select Image Editor | The Project lens exposes only verified provider profiles. | Left click at (688, 419). | 59 |  |
| 20 | left-click | Save Image Editor fake-local profile | The offline deterministic capability becomes the durable binding for this recovery-only run. | Left click at (1439, 468). | 91 |  |
| 21 | left-click | Select Batch | The progressive Inspector exposes the authored batch and its run scope. | Left click at (1013, 419). | 68 |  |
| 22 | left-click | Save two Batch values | The exact two-item expansion is stored before preview. | Left click at (1406, 774). | 95 |  |
| 23 | screenshot | Capture the blank-authored run graph | Prompt, Batch, Image Generator, Image Editor, and three visible lanes were created only through ordinary UI input. | Captured after the documented preceding action. | 211 | screenshots/01-blank-authored-run-graph.png |
| 24 | left-click | Preview explicit Batch scope | The immutable Batch scope expands dimensions and downstream work without starting it. | Left click at (1513, 682). | 82 |  |
| 25 | left-click | Expand compiled Batch steps | Exact compiled inputs and provider bindings are reviewable before any permit exists. | Left click at (1461, 591). | 30 |  |
| 26 | screenshot | Capture immutable Batch preview | The prepared plan exposes scope, identity, provider settings, call count, concurrency, batch expansion, boundary, and compiled inputs. | Captured after the documented preceding action. | 167 | screenshots/02-immutable-batch-preview.png |
| 27 | left-click | Select Image Generator | The same authored graph exposes node, branch, and downstream scope choices. | Left click at (363, 419). | 41 |  |
| 28 | left-click | Preview Node scope | Node only predicts two generator calls because the upstream Batch has two values. | Left click at (1407, 723). | 94 |  |
| 29 | left-click | Preview Branch scope | Branch includes the selected generator and downstream editor for both Batch values. | Left click at (1407, 723). | 87 |  |
| 30 | left-click | Preview Downstream scope | Downstream excludes the root generator and predicts one editor call for each Batch value. | Left click at (1407, 723). | 45 |  |
| 31 | keyboard-command | Select the authored induced graph | All four UI-authored nodes become the Selected execution boundary. | Pressed Control+A. | 14 |  |
| 32 | keyboard-command | Preview Selected scope | The first shortcut press prepares the exact selected-node plan and does not run it. | Pressed Control+Enter. | 49 |  |
| 33 | screenshot | Capture Selected scope after Node, Branch, and Downstream previews | The blank-authored induced selection has its own inspect-first plan and remains unstarted. | Captured after the documented preceding action. | 123 | screenshots/03-scope-comparison.png |
| 34 | left-click | Dismiss Selected preview | The provider-safe comparison closes without starting the selected plan. | Left click at (1289, 856). | 28 |  |
| 35 | left-click | Return to Image Generator | One small two-call fake-local job is isolated for the practical Job Center proof. | Left click at (363, 419). | 48 |  |
| 36 | left-click | Prepare two fake-local calls | The exact two-call Batch-expanded plan is reviewed before permission is granted. | Left click at (1407, 723). | 63 |  |
| 37 | left-click | Permit and start the reviewed plan | Only the displayed fake-local plan receives a one-use permit and starts. | Left click at (1403, 682). | 67 |  |
| 38 | left-click | Open Run workspace | Job Center hydrates the durable job created by the reviewed plan. | Left click at (169, 89). | 102 |  |
| 39 | left-click | Inspect authorized Job plan | Job Center shows the same immutable identity and exact plan after completion. | Left click at (1021, 910). | 397 |  |
| 40 | screenshot | Capture durable completed Job | The fake-local result is accepted and its immutable plan, attempt, timeline, and completion remain visible in Job Center. | Captured after the documented preceding action. | 286 | screenshots/04-job-center-result.png |
| 41 | observation | T13 practical slice | All five run scopes are inspect-first and one explicitly permitted offline job is durable. | Batch, Node, Branch, Downstream, and Selected previews were reviewed with their exact Batch-expanded call counts; only the final two-call fake-local Node plan started and completed with two accepted work items and two attempts. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
