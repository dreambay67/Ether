# connection-inspector-recovery action log

- Mode: packaged
- Outcome: failed
- Git commit: 9ea4bba1a64e2cbefee7b405b159f49bff168b10
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T22:17:45.587Z
- Finished: 2026-08-09T22:18:02.271Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec
- release/windows/win-unpacked/resources/app.asar: f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add review.evaluate from Node Library | The blank document creates review.evaluate through the canonical registry. | Left click at (108, 639). | 81 |  |
| 2 | left-click | Add flow.batch from Node Library | The blank document creates flow.batch through the canonical registry. | Left click at (108, 669). | 79 |  |
| 3 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 557). | 79 |  |
| 4 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 63 |  |
| 5 | left-click | Hide Reference Desk | The graph gets a clear practical authoring viewport. | Left click at (1581, 151). | 50 |  |
| 6 | left-click | Hide Build tools | The graph gets a clear practical authoring viewport. | Left click at (244, 183). | 59 |  |
| 7 | left-click | Hide Project lens | The graph gets a clear practical authoring viewport. | Left click at (1580, 183). | 44 |  |
| 8 | keyboard-command | Fit the blank-authored connection graph | All four authored cards and their channel rails fit in the visible canvas. | Pressed Home. | 5 |  |
| 9 | left-click | Begin Text lane | Only compatible receiver handles are emphasized for the Text channel. | Left click at (939, 633). | 159 |  |
| 10 | screenshot | Capture compatible channel intent | A deliberate source click reveals the compatible receiver rail before persistence. | Captured after the documented preceding action. | 195 | screenshots/01-compatible-six-channel-intent.png |
| 11 | left-click | Complete Text lane | The Text lane persists through the ordinary connection interaction. | Left click at (336, 408). | 293 |  |
| 12 | observation | First lane completion state | The saved graph and rendered path both report the completed Text lane. | {"status":"Connect nodes saved","sourceConnected":"true","targetConnected":"true","renderedEdges":1} | 0 |  |
| 13 | left-click | Begin Image lane | Only compatible receiver handles are emphasized for the Image channel. | Left click at (939, 662). | 250 |  |
| 14 | left-click | Complete Image lane | The Image lane persists through the ordinary connection interaction. | Left click at (336, 437). | 304 |  |
| 15 | left-click | Begin Mask lane | Only compatible receiver handles are emphasized for the Mask channel. | Left click at (939, 690). | 265 |  |
| 16 | left-click | Complete Mask lane | The Mask lane persists through the ordinary connection interaction. | Left click at (336, 465). | 299 |  |
| 17 | left-click | Begin Data lane | Only compatible receiver handles are emphasized for the Data channel. | Left click at (939, 719). | 262 |  |
| 18 | left-click | Complete Data lane | The Data lane persists through the ordinary connection interaction. | Left click at (336, 494). | 296 |  |
| 19 | left-click | Begin Video lane | Only compatible receiver handles are emphasized for the Video channel. | Left click at (939, 748). | 260 |  |
| 20 | left-click | Complete Video lane | The Video lane persists through the ordinary connection interaction. | Left click at (336, 523). | 275 |  |
| 21 | left-click | Begin Audio lane | Only compatible receiver handles are emphasized for the Audio channel. | Left click at (939, 776). | 250 |  |
| 22 | left-click | Complete Audio lane | The Audio lane persists through the ordinary connection interaction. | Left click at (336, 551). | 281 |  |
| 23 | left-click | Open the in-place role grid | All 15 semantic roles are available directly on the lane. | Left click at (637, 521). | 47 |  |
| 24 | left-click | Name the Text lane Subject | The non-General role becomes a visible lane badge. | Left click at (738, 566). | 77 |  |
| 25 | screenshot | Capture six persisted lanes | Six channel-specific paths coexist between the same node pair and one carries a visible Subject role. | Captured after the documented preceding action. | 206 | screenshots/02-six-channel-lanes-and-role.png |
| 26 | left-click | Select Evaluate before edge deletion | The source node remains the graph selection while an edge-only context action runs. | Left click at (800, 644). | 45 |  |
| 27 | right-click | Delete only the Text lane | Right-click removes the targeted edge without deleting or deselecting either node. | Right click at (593, 521). | 59 |  |
| 28 | left-click | Begin Data-to-Text adapter lane | The receiver Text handle is available through Ether's local data-to-text adapter. | Left click at (939, 494). | 250 |  |
| 29 | left-click | Complete adapter lane | The adapter-backed lane persists before any run or provider call. | Left click at (986, 408). | 300 |  |
| 30 | left-click | Select the adapter lane | A visible lane control selects the exact connection for the Project lens. | Left click at (962, 451). | 59 |  |
| 31 | left-click | Show Project lens | Ordinary connection controls appear without covering the completed authoring interaction. | Left click at (1584, 183). | 67 |  |
| 32 | left-click | Focus output selection | The lane's output policy is editable in the ordinary Inspector. | Left click at (1461, 657). | 68 |  |
| 33 | keyboard-command | Choose latest output | The selector changes from Latest approved to Latest output through the focused control. | Pressed ArrowDown. | 4 |  |
| 34 | keyboard-command | Commit output selection | The changed selector persists as a graph transaction. | Pressed Enter. | 33 |  |
| 35 | screenshot | Capture adapter consequence Inspector | The ordinary Inspector names the local adapter, receiver field, assembly, preservation, channels, role, and selector while diagnostics stay collapsed. | Captured after the documented preceding action. | 222 | screenshots/03-adapter-consequence-inspector.png |
| 36 | left-click | Open connection diagnostics deliberately | Expert adapter and capability details appear only after an explicit disclosure. | Left click at (1446, 907). | 26 |  |
| 37 | screenshot | Capture expert connection diagnostics | The deliberate Advanced view exposes the resolved adapter and capability requirement without starting work. | Captured after the documented preceding action. | 203 | screenshots/04-connection-diagnostics.png |
| 38 | left-click | Hide Project lens | The canvas regains clear pointer access for the next Inspector target. | Left click at (1580, 183). | 34 |  |
| 39 | left-click | Select the Batch node | The progressive node Inspector opens from a real canvas selection. | Left click at (475, 419). | 56 |  |
| 40 | left-click | Show Batch Inspector | Registry-backed ordinary controls are visible for the selected canonical node. | Left click at (1584, 183). | 68 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
