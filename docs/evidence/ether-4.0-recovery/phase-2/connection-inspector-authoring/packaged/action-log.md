# connection-inspector-recovery action log

- Mode: packaged
- Outcome: passed
- Git commit: 9872deaee3dd4457f09192da6d535ee3c76701f7
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T09:49:54.249Z
- Finished: 2026-08-11T09:50:07.202Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 4824a5a0b5189bfa805f5cabdb70e8ab74ed897a6438bc13c1a1db303b70cc3d
- release/windows/win-unpacked/resources/app.asar: a599062e8a65b0446ab31e7eaabcf48d431b164fa7ea4ac950267ac78703f60a

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add review.evaluate from Node Library | The blank document creates review.evaluate through the canonical registry. | Left click at (108, 639). | 79 |  |
| 2 | left-click | Add flow.batch from Node Library | The blank document creates flow.batch through the canonical registry. | Left click at (108, 669). | 62 |  |
| 3 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the canonical registry. | Left click at (108, 557). | 64 |  |
| 4 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 51 |  |
| 5 | left-click | Hide Reference Desk | The graph gets a clear practical authoring viewport. | Left click at (1581, 151). | 44 |  |
| 6 | left-click | Hide Build tools | The graph gets a clear practical authoring viewport. | Left click at (244, 183). | 51 |  |
| 7 | left-click | Hide Project lens | The graph gets a clear practical authoring viewport. | Left click at (1580, 183). | 46 |  |
| 8 | keyboard-command | Fit the blank-authored connection graph | All four authored cards and their channel rails fit in the visible canvas. | Pressed Home. | 8 |  |
| 9 | left-click | Begin Text lane | Only compatible receiver handles are emphasized for the Text channel. | Left click at (1091, 666). | 219 |  |
| 10 | screenshot | Capture compatible channel intent | A deliberate source click reveals the compatible receiver rail before persistence. | Captured after the documented preceding action. | 185 | screenshots/01-compatible-six-channel-intent.png |
| 11 | left-click | Complete Text lane | The Text lane persists through the ordinary connection interaction. | Left click at (811, 538). | 266 |  |
| 12 | observation | First lane completion state | The saved graph and rendered path both report the completed Text lane. | {"status":"Connect nodes saved","sourceConnected":"true","targetConnected":"true","renderedEdges":1} | 0 |  |
| 13 | left-click | Begin Image lane | Only compatible receiver handles are emphasized for the Image channel. | Left click at (1091, 675). | 236 |  |
| 14 | left-click | Complete Image lane | The Image lane persists through the ordinary connection interaction. | Left click at (811, 547). | 262 |  |
| 15 | left-click | Begin Mask lane | Only compatible receiver handles are emphasized for the Mask channel. | Left click at (1091, 685). | 233 |  |
| 16 | left-click | Complete Mask lane | The Mask lane persists through the ordinary connection interaction. | Left click at (811, 557). | 251 |  |
| 17 | left-click | Begin Data lane | Only compatible receiver handles are emphasized for the Data channel. | Left click at (1091, 694). | 223 |  |
| 18 | left-click | Complete Data lane | The Data lane persists through the ordinary connection interaction. | Left click at (811, 566). | 262 |  |
| 19 | left-click | Begin Video lane | Only compatible receiver handles are emphasized for the Video channel. | Left click at (1091, 704). | 251 |  |
| 20 | left-click | Complete Video lane | The Video lane persists through the ordinary connection interaction. | Left click at (811, 576). | 275 |  |
| 21 | left-click | Begin Audio lane | Only compatible receiver handles are emphasized for the Audio channel. | Left click at (1091, 713). | 245 |  |
| 22 | left-click | Complete Audio lane | The Audio lane persists through the ordinary connection interaction. | Left click at (811, 585). | 287 |  |
| 23 | left-click | Open the in-place role grid | All 15 semantic roles are available directly on the lane. | Left click at (951, 843). | 42 |  |
| 24 | left-click | Name the Text lane Subject | The non-General role becomes a visible lane badge. | Left click at (998, 864). | 71 |  |
| 25 | screenshot | Capture six persisted lanes | Six channel-specific paths coexist between the same node pair and one carries a visible Subject role. | Captured after the documented preceding action. | 159 | screenshots/02-six-channel-lanes-and-role.png |
| 26 | left-click | Select Evaluate before edge deletion | The source node remains the graph selection while an edge-only context action runs. | Left click at (1027, 667). | 35 |  |
| 27 | right-click | Delete only the role-edited lane | Right-click removes the targeted edge without deleting or deselecting either node. | Right click at (930, 843). | 60 |  |
| 28 | left-click | Begin Data-to-Text adapter lane | The receiver Text handle is available through Ether's local data-to-text adapter. | Left click at (789, 439). | 218 |  |
| 29 | left-click | Complete adapter lane | The adapter-backed lane persists before any run or provider call. | Left click at (509, 282). | 248 |  |
| 30 | left-click | Select the adapter lane | A visible lane control selects the exact connection for the Project lens. | Left click at (649, 501). | 45 |  |
| 31 | left-click | Show Project lens | Ordinary connection controls appear without covering the completed authoring interaction. | Left click at (1584, 183). | 51 |  |
| 32 | left-click | Focus output selection | The lane's output policy is editable in the ordinary Inspector. | Left click at (1461, 657). | 47 |  |
| 33 | keyboard-command | Choose latest output | The selector changes from Latest approved to Latest output through the focused control. | Pressed ArrowDown. | 4 |  |
| 34 | keyboard-command | Commit output selection | The changed selector persists as a graph transaction. | Pressed Enter. | 35 |  |
| 35 | screenshot | Capture adapter consequence Inspector | The ordinary Inspector names the local adapter, receiver field, assembly, preservation, channels, role, and selector while diagnostics stay collapsed. | Captured after the documented preceding action. | 194 | screenshots/03-adapter-consequence-inspector.png |
| 36 | left-click | Open connection diagnostics deliberately | Expert adapter and capability details appear only after an explicit disclosure. | Left click at (1446, 907). | 22 |  |
| 37 | screenshot | Capture expert connection diagnostics | The deliberate Advanced view exposes the resolved adapter and capability requirement without starting work. | Captured after the documented preceding action. | 201 | screenshots/04-connection-diagnostics.png |
| 38 | left-click | Hide Project lens | The canvas regains clear pointer access for the next Inspector target. | Left click at (1580, 183). | 34 |  |
| 39 | left-click | Select the Batch node | The progressive node Inspector opens from a real canvas selection. | Left click at (876, 540). | 47 |  |
| 40 | left-click | Show Batch Inspector | Registry-backed ordinary controls are visible for the selected canonical node. | Left click at (1584, 183). | 52 |  |
| 41 | left-click | Add a structured Batch dimension | The Inspector adds a named structured item rather than exposing raw JSON. | Left click at (1461, 568). | 43 |  |
| 42 | left-click | Add a structured Batch exclusion | The Inspector adds a key/value exclusion editor through an ordinary control. | Left click at (1461, 887). | 37 |  |
| 43 | left-click | Save structured Batch settings | The registry-backed draft commits through one durable graph transaction. | Left click at (1406, 580). | 26 |  |
| 44 | screenshot | Capture ordinary progressive Inspector | Concise channels and structured Batch controls are visible while technical provenance remains collapsed. | Captured after the documented preceding action. | 221 | screenshots/05-progressive-batch-inspector.png |
| 45 | left-click | Open node diagnostics deliberately | Stable IDs and provenance appear only in the expert disclosure. | Left click at (1446, 879). | 24 |  |
| 46 | screenshot | Capture deliberate node diagnostics | The expert section expands without path leakage or replacing ordinary authoring controls. | Captured after the documented preceding action. | 170 | screenshots/06-progressive-batch-advanced.png |
| 47 | observation | T10-T12 practical slice | Six channels, roles, edge deletion, adapters, consequences, and progressive controls work from a blank package. | Six same-pair lanes were authored; one was role-edited and edge-only deleted; a local adapter lane exposed its consequence; structured Batch settings saved without raw JSON. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
