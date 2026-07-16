# Ether 2.5 Connection Matrix

**Status:** Draft for approval
**Date:** 2026-06-30
**Purpose:** Normative matrix for deciding whether a connection is allowed, what adapter engages, and what backend effect happens.

---

## 1. Terminology

Ether connections have three layers:

- **Node family/subtype:** the box and its function.
- **Role:** how the receiving node interprets the payload.
- **Channel:** the payload type moving across the edge.

Channels are exactly:

- Text
- Image
- Mask
- Data
- Video
- Audio

Roles are exactly:

- General
- Negative
- Subject
- Product
- Face
- Clothing
- Pose
- Setting
- Composition
- Style
- Lighting
- Colour Palette
- Typography
- Motion
- Timing

`Instruction` is not a role. Node instructions define node behavior.
`Reference` is not a role. Reference behavior comes from the source node, channel, asset, and receiver.

---

## 2. Universal Channel-To-Channel Matrix

Legend:

- **Pass:** no adapter, same payload type.
- **Local:** deterministic local adapter.
- **Provider:** Codex/local/API/MCP provider capability required.
- **Node:** handled by the receiving node's run behavior, not by an edge adapter.
- **Blocked:** invalid until a real provider/adapter exists.

| Source -> Target | Text | Image | Mask | Data | Video | Audio |
|---|---|---|---|---|---|---|
| **Text** | Pass: compose/copy text. | Node: image generation only inside Generation; otherwise blocked. | Blocked unless a real text-to-mask provider exists. | Local/provider: parse JSON, extract tags, convert rubric/settings. | Blocked unless real text-to-video provider exists. | Blocked unless real text-to-audio provider exists. |
| **Image** | Provider/local: caption, OCR, visual description. | Pass: visual reference/source/output. | Provider: segmentation or mask extraction. | Local/provider: EXIF, dimensions, tags, visual analysis. | Blocked unless real image-to-video provider exists. | Blocked. |
| **Mask** | Local: mask summary, bounds, area, feather notes. | Local: mask preview/overlay image. | Pass: mask payload. | Local: bounds, coverage, polygon/raster metadata. | Blocked. | Blocked. |
| **Data** | Local/provider: serialize, summarize, render rules as text. | Node: chart/infographic generation only inside Generation; otherwise blocked. | Local: polygon/selection schema to raster mask. | Pass: merge/copy structured data. | Blocked unless real data-to-video provider exists. | Blocked unless real data-to-audio provider exists. |
| **Video** | Provider: transcript, caption, visual summary. | Local/provider: poster frame or keyframe extraction. | Provider: temporal/spatial mask extraction. | Local/provider: metadata, scene cuts, timecodes, semantic tags. | Pass/provider: preserve or real video transform. | Local/provider: extract audio track. |
| **Audio** | Provider: transcription, lyrics, spoken description. | Local/provider: waveform or spectrogram render. | Blocked. | Local/provider: metadata, BPM, cues, speaker/music analysis. | Blocked unless real audio-to-video visualization provider exists. | Pass/provider: preserve or real audio transform. |

Important distinction:

- Text feeding a Generation node normally connects **Text -> Text**. The Generation node then outputs Image when run.
- Text -> Image as an edge means "convert this text payload into an image before the target consumes it." That is blocked except inside a real Generation node/provider path.

---

## 3. Node Family Channel Capabilities

| Node family | Accepts | Produces | Notes |
|---|---|---|---|
| Prompt | Text, Data, Image/Video/Audio through adapters | Text, Data | Brainstormer/Mutator/Expander/Reinforcer are Prompt-family executable nodes. |
| Reference | Text annotations, Image, Video, Audio, Data | Text sidecars, Image, Video, Audio, Data | Holds media assets and sidecars. |
| Generation | Text, Image, Data; Audio/Video only through provider support or adapters | Image, Data, Text run summary | 2.5 requires image generation only. Video/audio generation is disabled unless real provider exists. |
| Edit | Text, Image, Mask, Data; Video/Audio only with real provider | Image, Mask, Data | Image edit is required. Video/audio edit is capability-gated. |
| Review | Text, Image, Data, Video, Audio, Mask metadata | Data, Text, selected media passthrough | Compare/Evaluation/Filter functions live here. |
| Store | Text, Image, Mask, Data, Video, Audio | Data manifest, same-channel passthrough | Collection and Directory persist assets and lineage. |
| Note | Text, Image from free-draw render, Mask from free-draw mask mode, Data | Text, Image, Mask, Data | Cloud/Bubble mainly Text; Free Draw can produce Image/Mask when implemented. |

---

## 4. Node-To-Node Matrix

Each cell lists allowed channel pairs. Any channel pair not listed is blocked unless a future provider profile explicitly enables it and tests are added.

Shorthand:

- T = Text
- I = Image
- M = Mask
- D = Data
- V = Video
- A = Audio

### Prompt As Source

| Prompt -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Prompt -> Prompt | T->T, D->D, D->T | Compose, mutate, expand, or summarize prompt material. |
| Prompt -> Reference | T->T, T->D | Add captions, labels, or metadata to a reference node. |
| Prompt -> Generation | T->T, D->D | Prompt assembly, generation settings, variables, constraints. |
| Prompt -> Edit | T->T, D->D | Edit instruction, constraints, edit parameters. |
| Prompt -> Review | T->T, T->D, D->D | Review rubric, criteria, evaluation settings. |
| Prompt -> Store | T->T, T->D, D->D | Store text, manifest notes, tags. |
| Prompt -> Note | T->T, D->T | Create note text or summarize structured data into note text. |

### Reference As Source

| Reference -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Reference -> Prompt | T->T, I->T, V->T, A->T, D->T, D->D | Caption/OCR/transcribe/summarize reference into prompt material. |
| Reference -> Reference | I->I, V->V, A->A, T->T, D->D, V->I, A->I | Reuse media, extract poster/waveform previews, copy sidecars. |
| Reference -> Generation | I->I, T->T, D->D, V->T, A->T, V->I | Image reference, prompt sidecars, metadata, media interpretation adapters. |
| Reference -> Edit | I->I, M->M, T->T, D->D, V->T, V->I, A->T | Source image/reference, mask, edit guidance, media interpretation. |
| Reference -> Review | I->I, V->V, A->A, T->T, D->D, I->T, V->T, A->T, I->D, V->D, A->D | Compare/evaluate media, captions, transcripts, metadata. |
| Reference -> Store | T->T, I->I, M->M, D->D, V->V, A->A | Persist assets with lineage. |
| Reference -> Note | T->T, I->I, V->I, A->I, D->T | Add media preview or summary to note. |

### Generation As Source

| Generation -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Generation -> Prompt | T->T, I->T, D->T, D->D | Reuse prompt echo, caption generated image, summarize run metadata. |
| Generation -> Reference | I->I, T->T, D->D | Turn output into reusable reference. |
| Generation -> Generation | T->T, I->I, D->D, I->T | Branch prompt, use image as reference, summarize previous output. |
| Generation -> Edit | I->I, T->T, D->D | Use generated image as edit source, carry prompt/run data. |
| Generation -> Review | I->I, T->T, D->D, I->T, I->D | Compare/evaluate generated output and metadata. |
| Generation -> Store | I->I, T->T, D->D | Store output, prompt, metadata. |
| Generation -> Note | I->I, T->T, D->T | Pin output or run summary to canvas note. |

### Edit As Source

| Edit -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Edit -> Prompt | T->T, I->T, D->T, D->D | Caption edited image or summarize edit metadata. |
| Edit -> Reference | I->I, M->M, T->T, D->D | Reuse edited result, mask, or notes as reference material. |
| Edit -> Generation | I->I, T->T, D->D, I->T | Use edited image as reference/source inspiration. |
| Edit -> Edit | I->I, M->M, T->T, D->D | Chain edits, reuse masks, carry instructions. |
| Edit -> Review | I->I, M->D, T->T, D->D, I->T, I->D | Evaluate edited result, mask coverage, metadata. |
| Edit -> Store | I->I, M->M, T->T, D->D | Store edit output, mask, recipe, lineage. |
| Edit -> Note | I->I, M->I, T->T, D->T | Pin edited image, mask preview, or summary to note. |

### Review As Source

| Review -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Review -> Prompt | D->T, T->T, I->T, V->T, A->T | Turn evaluation/filter results into prompt guidance. |
| Review -> Reference | I->I, V->V, A->A, T->T, D->D | Promote selected media or review sidecars into references. |
| Review -> Generation | T->T, D->D, I->I | Use review conclusions, selected images, or constraints for new generation. |
| Review -> Edit | T->T, D->D, I->I, M->M | Send review feedback, selected asset, or mask to edit. |
| Review -> Review | T->T, D->D, I->I, V->V, A->A | Multi-stage compare/evaluate/filter. |
| Review -> Store | T->T, I->I, D->D, V->V, A->A | Route approved/rejected/needs-edit assets and decisions. |
| Review -> Note | D->T, T->T, I->I | Pin review result or selected asset to canvas. |

### Store As Source

| Store -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Store -> Prompt | T->T, D->T, I->T, V->T, A->T | Reuse collection notes, metadata, or media descriptions. |
| Store -> Reference | I->I, V->V, A->A, T->T, D->D | Rehydrate stored assets as references. |
| Store -> Generation | I->I, T->T, D->D, V->T, A->T | Use stored references, prompts, metadata, transcripts. |
| Store -> Edit | I->I, M->M, T->T, D->D, V->T, A->T | Use stored source assets, masks, instructions. |
| Store -> Review | I->I, V->V, A->A, T->T, D->D | Review collection contents. |
| Store -> Store | T->T, I->I, M->M, D->D, V->V, A->A | Copy/move/link between collections/directories. |
| Store -> Note | T->T, I->I, D->T, V->I, A->I | Pin stored item preview or metadata summary. |

### Note As Source

| Note -> Target | Allowed channel pairs | Backend effect |
|---|---|---|
| Note -> Prompt | T->T, I->T, M->D, D->T | Use note text, free-draw caption, mask metadata. |
| Note -> Reference | T->T, I->I, M->I, D->D | Attach note text or free-draw preview as reference material. |
| Note -> Generation | T->T, I->I, M->D, D->D | Use note text, sketch image, or selection metadata as generation context. |
| Note -> Edit | T->T, I->I, M->M, D->D | Use note instruction, sketch/reference, or mask. |
| Note -> Review | T->T, I->I, M->D, D->D | Use notes or sketches as review criteria/evidence. |
| Note -> Store | T->T, I->I, M->M, D->D | Store notes, sketches, masks, metadata. |
| Note -> Note | T->T, I->I, M->I, D->T | Copy/merge notes and visual annotations. |

---

## 5. Special Cases And Examples

### Image To Text

Allowed when the receiving node accepts Text and a vision/OCR provider or local OCR adapter exists.

Background effect:

1. Run image caption/OCR adapter.
2. Store transcript/caption as Text artifact.
3. Preserve source Image artifact and lineage.
4. Feed resulting Text to target node with the selected role.

Examples:

- Image Reference -> Prompt as Text / Subject: caption subject into prompt material.
- Generated Image -> Evaluation as Text / Composition: describe composition for text-based evaluation.
- Image -> Note as Text / General: create a visual note caption.

### Audio To Text

Allowed only when transcription provider exists.

Background effect:

1. Run transcription adapter.
2. Store transcript Text artifact with timestamps if available.
3. Preserve Audio artifact and lineage.
4. Feed transcript to target node with selected role.

### Video To Text

Allowed only when transcription/caption provider exists.

Background effect:

1. Extract audio track or send video to capable provider.
2. Produce transcript/caption Text artifact.
3. Preserve Video artifact and timestamps.
4. Feed Text to target node with selected role.

### Data To Evaluation

No adapter required when target accepts Data.

Background effect:

1. Pass structured Data payload to Evaluation.
2. Evaluation node instruction defines what to do.
3. Evaluation emits Data result.

Example:

```text
Channel: Data -> Data
Role: Subject
Receiving node: Evaluation
Instruction: Rate the subject based on the western standard of beauty.
```

### Text To Image

Not an edge adapter by default.

Correct flow:

```text
Prompt node -- Text / Subject --> Generation node
Generation node -- Image / General --> downstream node
```

Text-to-image is the Generation node's function, not a generic channel adapter.

---

## 6. Implementation Rule

A connection is valid only if all are true:

1. Source node can produce the source channel.
2. Target node can accept the target channel.
3. Source-target family pair allows the channel pair.
4. If source and target channels differ, the adapter is available.
5. The selected role is in the fixed role list.
6. The target node has a concrete backend effect for that role/channel pair.

Otherwise Ether must show a disabled edge or rejection reason. It must not create a decorative connection with no backend consequence.
