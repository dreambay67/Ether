# Ether 2.5 Product And Design Spec

**Status:** Draft for approval
**Date:** 2026-06-30
**Product:** Ether by DreamBay
**Platform:** Windows desktop, local-first
**Supersedes:** Ether 2.1 design direction. Ether 2.1 remains useful as a failure analysis and layout reference, but its connection model is obsolete.

---

## 1. Product Promise

Ether 2.5 is a local-first node canvas for building serious multimodal creative workflows. It separates the graph into three simple layers:

1. **Nodes:** the boxes and functions on the canvas.
2. **Roles:** fixed interpretation labels on connection lanes.
3. **Channels:** the actual payload moving between nodes.

This is the core correction. Previous builds mixed these concepts together, which created cluttered ports, confusing prompt subnodes, and backend paths that did not always match the visual model.

2.5 must make every visible connection mean something. An allowed connection must either execute a real backend effect or be disabled with a clear reason.

---

## 2. Non-Negotiable Model

### 2.1 Nodes

Nodes are the large boxes on the canvas. They define the operation or storage object.

Node family colors are stable. Subtypes change behavior but stay within the same family color.

### 2.2 Roles

Roles tell the downstream node how to interpret an input. Roles are not channels. Roles are not node functions.

Example:

```text
Source channel: Data
Target channel: Data
Role: Subject
Receiving node: Evaluation
Evaluation instruction: Rate the subject based on the western standard of beauty.
```

The specialized rating behavior belongs to the Evaluation node instruction, not to a role called "rating composition" or "beauty score."

### 2.3 Channels

Channels define the payload type. There are exactly six visible channels:

- Text
- Image
- Mask
- Data
- Video
- Audio

The following are not channels:

- prompt
- reference
- evaluation
- collection
- route
- edited image
- negative prompt

Those concepts are node functions, roles, metadata, or legacy artifact kinds.

---

## 3. Fixed Role Vocabulary

Ether 2.5 uses exactly 15 user-facing roles:

1. General
2. Negative
3. Subject
4. Product
5. Face
6. Clothing
7. Pose
8. Setting
9. Composition
10. Style
11. Lighting
12. Colour Palette
13. Typography
14. Motion
15. Timing

Default role: **General**.

Clarification:

- **General** is the neutral default for context that does not need a more specific role.
- **Instruction** is not a role in 2.5. Node instructions define what a node should do.
- **Reference** is not a role in 2.5. Reference behavior comes from the channel, the source node, the asset, and the receiving node.
- **Motion** and **Timing** cover video/action/rhythm/pacing needs without making node functions into roles.

Role aliases during migration:

- `context` -> General
- `prompt` -> General
- `negativePrompt` -> Negative
- `colour`, `color`, `palette`, `colourPalette` -> Colour Palette
- `action`, `movement`, `cameraMove` -> Motion
- `rhythm`, `pace`, `duration`, `timecode` -> Timing
- `face`, `product`, `subject`, `style`, `composition`, `lighting`, `setting`, `pose`, `clothing`, `typography` -> their matching roles
- unknown legacy labels -> General with a migration warning

Roles are selected by clicking the small role box on the connection lane. The role selector is a fixed 5-by-3 grid. Invalid role/channel/node combinations are disabled with a tooltip or inline explanation, not hidden.

---

## 4. Channel Model

### 4.1 Canonical Channels

Internal ids:

```ts
type PayloadChannel = "text" | "image" | "mask" | "data" | "video" | "audio";
```

Display names:

- `text` -> Text
- `image` -> Image
- `mask` -> Mask
- `data` -> Data
- `video` -> Video
- `audio` -> Audio

### 4.2 Source And Target Channels

Most edges are same-channel:

```text
Text -> Text
Image -> Image
Data -> Data
```

Some edges are cross-channel and require a real adapter:

```text
Audio -> Text
Video -> Text
Video -> Image
Video -> Data
Audio -> Data
```

This is necessary because audio/video interpretation cannot be represented honestly by a single channel label. The edge stores both sides:

```ts
type EtherEdgeData25 = {
  graphVersion: "2.5";
  sourceChannel: PayloadChannel;
  targetChannel: PayloadChannel;
  role: ConnectionRole;
  adapter?: {
    operation: "transcribe" | "caption" | "extract" | "interpret" | "transform";
    providerId: string;
    status: "available" | "unavailable" | "blocked";
    reason?: string;
  };
  disabledReason?: string;
  migratedFrom?: Record<string, unknown>;
};
```

If `sourceChannel` and `targetChannel` differ, the UI shows a small adapter badge on the lane. The backend must include the adapter in run preview and execution.

### 4.3 Channel Restrictions

Rules:

- Text, Image, Mask, and Data may be produced by real node functions already planned for 2.5.
- Video and Audio are first-class input/reference channels.
- Video-to-video and Audio-to-audio connections are allowed only for preservation, collection, comparison, or real provider-backed transforms.
- Text/Image/Data/Mask-to-Video and Text/Image/Data/Mask-to-Audio are blocked unless a real generation provider explicitly supports them.
- Audio-to-Text is allowed only when a real transcription provider is available.
- Video-to-Text is allowed only when a real transcription/caption provider is available.
- Video-to-Image is allowed only when real keyframe/poster extraction is available.
- Audio/Video-to-Data may store file metadata when real metadata extraction exists; deeper semantic analysis requires a provider.

No placeholder media outputs are allowed.

### 4.4 Connection Matrix

The detailed channel-to-channel and node-to-node rules live in:

- `docs/product/ether-2.5-connection-matrix.md`

The matrix is normative for implementation. The rule is:

1. The source node must produce the source channel.
2. The target node must accept the target channel.
3. If source and target channels differ, a real adapter must exist.
4. The source node, target node, channel pair, and role must resolve to a concrete backend effect.
5. If any condition fails, the connection is disabled with a user-facing reason.

---

## 5. Node Taxonomy

### 5.1 Families And Subtypes

Ether 2.5 families:

#### Prompt

Prompt family has exactly five subnodes:

- Prompt
- Brainstormer
- Mutator
- Expander
- Reinforcer

The standalone Assistant family is removed. Assistant behavior lives inside Prompt family subtypes.

Removed Prompt subnodes:

- Subject Prompt
- Clothing Prompt
- Pose Prompt
- Setting Prompt
- Composition Prompt
- Style Prompt
- Lighting Prompt
- Colour Palette Prompt
- Typography Prompt
- Custom Prompt
- Negative Prompt

Those meanings now come from edge roles.

#### Reference

- Image
- Video Reference
- Audio Reference
- Colour Grid
- Moodboard

Reference nodes can hold one or more media assets. They output the asset's channel and metadata.

#### Generation

- Image
- Grid
- Character Sheet
- Infographic

2.5 keeps image generation as the only required generation surface unless a real video/audio generation provider is configured. Video/audio generation slots may be visible as disabled future capabilities only if clearly labeled unavailable.

#### Edit

- Inpaint
- Expand / Outpaint
- Draw & Note
- Upscale

Edit nodes accept Image, Mask, Text, and Data where supported. They may accept Video/Audio only when a provider capability exists.

#### Review

- Compare
- Evaluation
- Filter

Review nodes operate on Image, Video, Audio, Text, and Data where provider capability exists. Evaluation and Filter primarily emit Data.

#### Store

- Collection
- Directory

Store nodes persist assets, metadata, and lineage. They do not invent new channels.

#### Note

- Cloud
- Bubble
- Free Draw

Cloud and Bubble must be real non-rectangular note visuals. Free Draw must be a real persisted stroke surface.

### 5.2 Node Header

Each node header shows two compact boxes:

- Family
- Subtype

Family color stays stable across all subtypes. Subtype is represented by text/icon/function, not by a new color.

---

## 6. Prompt Assembly

### 6.1 One Prompt Node

There is one authored Prompt node. Section meaning comes from incoming edge roles.

Example:

```text
Prompt node A -- Text / Subject --> Generation
Prompt node B -- Text / Subject --> Generation
Prompt node C -- Text / Lighting --> Generation
Prompt node D -- Text / Negative --> Generation
```

Assembled prompt:

```text
Subject: ...
Subject 2: ...
Lighting: ...
```

Assembled negative prompt:

```text
Negative: ...
```

### 6.2 Numbering

Repeated roles are numbered deterministically by graph order:

```text
Subject: ...
Subject 2: ...
Subject 3: ...
```

The first role occurrence is not numbered unless a user setting later requests all numbering.

### 6.3 Assistant-Like Prompt Subtypes

Brainstormer, Mutator, Expander, and Reinforcer are executable Prompt-family nodes.

They may emit:

- Text
- Data

They may inspect upstream channels where provider capability exists:

- Text
- Image
- Data
- Audio/Video through explicit interpretation adapters

Downstream Prompt nodes can either:

- inspect before apply; or
- auto-apply, if the node setting enables it.

Default: inspect before apply.

---

## 7. Connection Interaction

### 7.1 No Scrollwheel Selection

Scrollwheel role/channel selection is removed.

Mouse wheel behavior must not change channel or role. During connection creation, scroll zoom should be suspended if it interferes with precise channel selection.

### 7.2 Channel Rails

Node edges expose six channel zones:

- Text
- Image
- Mask
- Data
- Video
- Audio

At rest:

- only connected channel dots are visible;
- empty zones are hidden;
- channel labels are hidden.

On node hover, keyboard focus, or active connection drag:

- all available zones appear;
- unavailable zones are dimmed;
- labels appear only as hover/focus tooltips.

### 7.3 Dot Geometry

Required geometry:

- visual dot: 12px
- hit target: 28px minimum
- rail inset: 28px top and bottom
- minimum center gap: 22px
- if the node is too small, increase node min-height rather than compressing dots
- dot positions recompute when the node resizes

Each channel dot uses both color and shape:

- Text: Electric Blue circle
- Image: Aqua rounded square
- Mask: Violet hollow ring
- Data: Cyan diamond
- Video: amber play-notch
- Audio: rose waveform tick

### 7.4 Creating A Connection

Flow:

1. User hovers a node edge.
2. Six channel zones appear.
3. User starts dragging from a source zone.
4. Compatible target zones appear on nearby/hovered nodes.
5. User releases on a target zone.
6. If source and target channels match, create same-channel edge.
7. If channels differ, create edge only if a real adapter can satisfy the conversion.
8. The edge role defaults to General.
9. The role box appears on the connection lane.

If invalid, Ether shows the reason near the cursor and records it in graph validation.

### 7.5 Editing A Connection

- Clicking the role box opens the 5-by-3 role grid.
- Right-clicking the endpoint or lane deletes the connection.
- Right-dragging an endpoint changes the channel by moving it to another channel zone.
- Undo/redo covers create, delete, role change, and channel change.

### 7.6 Edge Bundles

Multiple edges between the same nodes are rendered as an edge bundle. Each lane has its own role box and channel semantics. Shared channel dots are allowed on node rails.

Multiple edges using one node/channel dot show a small count ring or stacked micro-dot. They do not create duplicate labels.

---

## 8. Backend Payloads

### 8.1 Payload Envelope

All execution inputs and outputs use a common envelope:

```ts
type PayloadEnvelope = {
  id?: string;
  channel: PayloadChannel;
  role: ConnectionRole;
  uri?: string;
  mimeType?: string;
  text?: string;
  metadata: Record<string, unknown>;
  sourceNodeId?: string;
  sourceEdgeId?: string;
};
```

### 8.2 Backend Effects

Allowed connections must map to a concrete effect:

- Text into Prompt or Generation: role-captioned prompt assembly.
- Text with Negative role: negative prompt assembly.
- Text into Edit: edit instruction/guidance.
- Image into Generation: visual reference input with role.
- Image into Edit: source image or visual guidance, based on target node and role.
- Mask into Edit: mask input.
- Data into Evaluation/Filter/Collection: structured scoring, routing, tags, or lineage.
- Image/Video/Audio into Collection: local storage with channel/role metadata.
- Image into Evaluation: vision evaluation.
- Audio into Text: transcription adapter.
- Video into Text: transcription/caption adapter.
- Video into Image: keyframe/poster extraction adapter.
- Audio/Video into Data: technical or semantic metadata adapter.

If no effect exists, the connection is invalid.

### 8.3 Provider Capability Profiles

Provider profiles are operation-based:

```ts
type ProviderOperation =
  | "generate"
  | "transform"
  | "interpret"
  | "transcribe"
  | "caption"
  | "evaluate"
  | "extract";

type ProviderCapabilityProfile = {
  providerId: string;
  modelId?: string;
  route: "codex-cli" | "local-tool" | "mcp" | "api" | "simulation" | "unavailable";
  operation: ProviderOperation;
  inputChannels: PayloadChannel[];
  outputChannels: PayloadChannel[];
  capabilitySource:
    | "cli-discovered"
    | "api-discovered"
    | "adapter-static"
    | "simulation-static"
    | "unavailable-slot";
  requiresExplicitSelection: true;
  noHiddenFallback: true;
  mediaLimits?: {
    maxBytes?: number;
    maxDurationMs?: number;
    mimeTypes?: string[];
  };
};
```

Run preview must show required provider/adaptor calls before execution.

### 8.4 Provider Runs

Every provider or adapter call writes a bounded `provider_runs` record:

- provider id;
- model id;
- operation;
- capability source;
- input artifact ids;
- output artifact ids;
- request json;
- response json;
- error json;
- run id;
- job item id;
- failure category, if any.

No hidden fallback is allowed.

---

## 9. Audio And Video

### 9.1 Audio

Audio channel supports:

- imported audio references;
- waveform preview when supported;
- metadata storage;
- Audio-to-Text transcription when provider is available;
- Audio-to-Data analysis when provider is available;
- Audio-to-Audio preservation, collection, comparison, or real transform.

Audio channel does not support:

- Text-to-Audio generation unless a real configured provider supports it.

### 9.2 Video

Video channel supports:

- imported video references;
- poster frame preview when extraction is available;
- metadata storage;
- Video-to-Text transcription/captioning when provider is available;
- Video-to-Image keyframe/poster extraction when provider is available;
- Video-to-Data analysis when provider is available;
- Video-to-Video preservation, collection, comparison, or real transform.

Video channel does not support:

- Text-to-Video or Image-to-Video generation unless a real configured provider supports it.

### 9.3 Media Capability Detection

No `ffmpeg` or `ffprobe` is assumed. Media features must check provider/local tool availability.

If no media provider exists, the UI still allows importing audio/video references but disables interpretation edges with a clear message.

---

## 10. Storage And Lineage

Artifacts store:

- channel;
- role;
- media type;
- URI/path;
- metadata;
- source node id;
- source edge id;
- provider run id;
- parent artifact ids;
- transcript/caption sidecar paths where applicable.

Storage directories:

- `assets/text`
- `assets/images`
- `assets/masks`
- `assets/data`
- `assets/video`
- `assets/audio`

Legacy `assetKind` remains migration metadata only. New code should use `channel`.

---

## 11. Graph Versioning And Migration

New graphs persist:

```json
{
  "graphVersion": "2.5"
}
```

Migration runs at:

- project open;
- revision load;
- graph patch import;
- template insertion if legacy templates remain.

Legacy mapping:

- `prompt`, `negativePrompt`, `text`, `note` -> Text
- `reference`, `image`, `editedImage` -> Image
- `mask` -> Mask
- `metadata`, `collection`, `route`, `evaluation`, `filterRule`, `compare` -> Data
- video assets -> Video
- audio assets -> Audio

Legacy prompt subnodes are preserved as Prompt nodes with migrated roles on outgoing edges. Migration must not silently delete content, layout, assets, or edges.

Invalid migrated edges remain visible as disabled edges with a reason.

Migration must be idempotent.

---

## 12. UI And Visual System

2.5 keeps the DreamBay/Ether visual rules:

- Ether remains a DreamBay tool.
- Ether logo remains the official gradient mark.
- Electric Blue `#1470DB` is the primary Ether tool/canvas color.
- Dark compact panels are the default surface.
- Aqua, cyan, violet, amber, rose, and neutral signals are functional accents.
- Clear bubbles and pressure rings represent operational state only.

### 12.1 Panels

Finish the real pane model:

- top toolbox resizable/hideable;
- bottom run trace resizable/hideable;
- left library resizable/hideable;
- right inspector resizable/hideable;
- minimap never overlaps inspector;
- command buttons never collapse into vertical text.

### 12.2 Notes

Cloud:

- actual cloud silhouette;
- dark translucent fill;
- thin cyan/aqua outline.

Bubble:

- actual oval/circle bubble;
- sparse clear highlight;
- no rounded-rectangle fallback.

Free Draw:

- real drawing surface;
- persisted strokes;
- undo/redo;
- eraser;
- size/opacity;
- token-limited colors.

### 12.3 Reference Previews

Reference nodes show channel-specific previews:

- Text: excerpt and line count.
- Image: thumbnail grid.
- Mask: source thumbnail plus mask overlay.
- Data: compact key/value or table preview.
- Video: poster frame and duration when available.
- Audio: waveform strip and duration when available.

Missing file states are visible on card and inspector.

---

## 13. Codex Skill Assembly

The Ether Codex plugin must be updated for 2.5. Skills must teach and enforce the new grammar.

Required skills:

1. `ether-workflow`
2. `ether-graph-architect`
3. `ether-connection-model`
4. `ether-prompt-systems`
5. `ether-artifact-librarian`
6. `ether-review-router`
7. `ether-provider-safety`
8. `ether-recovery`

`ether-connection-model` is the canonical taxonomy skill. Other skills should reference it instead of repeating conflicting rules.

Skill rules:

- mention exactly six channels;
- mention exactly 15 roles;
- default role is General;
- roles are not channels;
- node functions are not roles;
- old Prompt subnodes are forbidden;
- Assistant family is removed;
- audio/video generation must not be promised without provider capability;
- every recipe must use channel plus role edges.

Plugin manifest must advertise:

- 2.5 Node / Role / Channel model;
- multimodal media routing;
- channel-aware graph validation;
- Codex workflow construction for Ether.

---

## 14. New Workflow Features For 2.5

### 14.1 Channel-Aware Graph Validator

Shows:

- invalid channel pairs;
- unavailable adapters;
- missing providers;
- disabled migrated edges;
- node instructions that do not match incoming roles/channels;
- media files missing from disk;
- run branches ready to execute.

### 14.2 Adapter Preview

Run preview must list implicit adapter steps:

```text
Audio -> Text: transcribe with provider X
Video -> Text: caption/transcribe with provider Y
Video -> Image: extract poster frame with provider/tool Z
```

If unavailable, the run is blocked before execution.

### 14.3 Role-Aware Prompt Inspector

The inspector shows assembled sections by role, including repeated role numbering and negative routing.

### 14.4 Media Reference Inspector

Reference inspector supports:

- add/replace multiple media assets;
- channel detection;
- role metadata;
- media provider health;
- transcript/caption sidecars.

### 14.5 Migration Report

After opening an old project, Ether shows:

- migrated nodes;
- migrated edges;
- disabled edges;
- role aliases used;
- old fields preserved as migration metadata.

---

## 15. Acceptance Criteria

2.5 is accepted only if:

- persisted graphs include `graphVersion: "2.5"`;
- there are exactly six channels in UI and engine;
- there are exactly 15 roles in UI and engine;
- Assistant is no longer a node family;
- Prompt family has exactly five subnodes;
- old prompt subnodes are gone from the library;
- prompt assembly uses edge roles and numbering;
- Negative is a role, not a prompt subtype/channel;
- channel rails show six zones during connection creation;
- connected channel dots are visible and spaced evenly;
- labels appear only on hover/focus;
- role box opens a fixed 5-by-3 grid;
- wheel does not change role or channel;
- right-click deletes connections;
- right-drag changes endpoint channel;
- all allowed connections have backend impact;
- invalid media adapters are disabled with explanation;
- Audio-to-Text and Video-to-Text are available only through real providers;
- no silent provider fallback occurs;
- Data into Evaluation works with role plus node instruction;
- Collection stores channel/role metadata and lineage;
- Cloud, Bubble, and Free Draw are real visuals/behaviors;
- panel resizing and inspector button readability are fixed;
- Codex plugin skills teach the 2.5 model;
- legacy graphs migrate without silent data loss;
- tests and screenshots cover the old failure cases.

---

## 16. Non-Goals

- No browser or desktop automation provider path.
- No hidden API fallback.
- No fake audio/video generation.
- No collapsing legacy prompt subnodes into one node during migration unless the user explicitly chooses a cleanup command.
- No new cloud sync.
- No public launch distribution work beyond making the Windows app robust and verifiable.
