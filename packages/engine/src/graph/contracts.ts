import { NODE_DEFINITIONS, type EtherNodeDefinition } from "./nodeCatalog.js";
import type { PayloadChannel } from "./channels.js";

export type ContractArtifactKind =
  | "prompt"
  | "negativePrompt"
  | "reference"
  | "image"
  | "video"
  | "audio"
  | "mask"
  | "metadata"
  | "collection"
  | "note"
  | "compare"
  | "evaluation"
  | "filterRule"
  | "editedImage"
  | "text"
  | "route";

export type ContractPortDirection = "input" | "output";

export type ContractPort = {
  id: ContractArtifactKind;
  label: string;
  artifactKind: ContractArtifactKind;
  direction: ContractPortDirection;
  required: boolean;
  description: string;
};

export type NodeContractHelp = {
  acceptedInputs: string;
  producedOutputs: string;
  primaryAction: string;
  useCase: string;
  graphInputs: ContractArtifactKind[];
  manualInputs: ContractArtifactKind[];
  graphInputHelp: string;
  manualInputHelp: string;
};

export type NodeContract = {
  definitionId: string;
  acceptedInputs: ContractArtifactKind[];
  producedOutputs: ContractArtifactKind[];
  acceptedChannels: PayloadChannel[];
  producedChannels: PayloadChannel[];
  inputPorts: ContractPort[];
  outputPorts: ContractPort[];
  runnable: boolean;
  runLabel: string;
  description: string;
  help: NodeContractHelp;
};

const artifactLabels: Record<ContractArtifactKind, string> = {
  prompt: "Prompt",
  negativePrompt: "Negative prompt",
  reference: "Reference",
  image: "Image",
  video: "Video",
  audio: "Audio",
  mask: "Mask",
  metadata: "Metadata",
  collection: "Collection",
  note: "Note",
  compare: "Compare",
  evaluation: "Evaluation",
  filterRule: "Rule",
  editedImage: "Edited image",
  text: "Text",
  route: "Route"
};

const inputDescriptions: Record<ContractArtifactKind, string> = {
  prompt: "Prompt text or assembled prompt material.",
  negativePrompt: "Negative constraints for generation or editing.",
  reference: "Role-labeled visual reference material.",
  image: "Image artifact from generation, edit, or import.",
  video: "Video clip reference material.",
  audio: "Audio reference material.",
  mask: "Mask guidance for edits.",
  metadata: "Structured context and routing metadata.",
  collection: "A local collection destination or bundle.",
  note: "Canvas note context.",
  compare: "Manual comparison membership and winner review.",
  evaluation: "Review or evaluation result.",
  filterRule: "Routing rule set.",
  editedImage: "Edited image artifact.",
  text: "Plain text context.",
  route: "Routing destination."
};

type NodeContractCore = Omit<NodeContract, "inputPorts" | "outputPorts" | "help">;
type NodeContractDraft = NodeContractCore & {
  useCase: string;
  graphInputs?: ContractArtifactKind[];
  manualInputs?: ContractArtifactKind[];
};

const ALL_CHANNELS: PayloadChannel[] = ["text", "image", "mask", "data", "video", "audio"];
const PROMPT_CHANNELS: PayloadChannel[] = ["text", "data"];
const IMAGE_DATA_CHANNELS: PayloadChannel[] = ["image", "data"];
const TEXT_IMAGE_DATA_CHANNELS: PayloadChannel[] = ["text", "image", "data"];
const EDIT_CHANNELS: PayloadChannel[] = ["image", "mask", "text", "data"];
const REVIEW_INPUT_CHANNELS: PayloadChannel[] = ["text", "image", "data", "video", "audio"];
const REVIEW_OUTPUT_CHANNELS: PayloadChannel[] = ["data", "text", "image", "video", "audio"];
const NOTE_OUTPUT_CHANNELS: PayloadChannel[] = ["text", "image", "mask", "data"];

function formatArtifactLabels(artifactKinds: ContractArtifactKind[]) {
  const labels = artifactKinds.map((artifactKind) => artifactLabels[artifactKind].toLowerCase());

  if (labels.length === 0) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function createInputClassification(draft: NodeContractDraft) {
  const graphInputs = draft.graphInputs ?? draft.acceptedInputs.filter((input) => !draft.manualInputs?.includes(input));
  const manualInputs = draft.manualInputs ?? draft.acceptedInputs.filter((input) => !graphInputs.includes(input));

  return {
    graphInputs,
    manualInputs
  };
}

function createHelp(
  contract: NodeContractCore,
  useCase: string,
  inputClassification: { graphInputs: ContractArtifactKind[]; manualInputs: ContractArtifactKind[] }
): NodeContractHelp {
  const { graphInputs, manualInputs } = inputClassification;
  const graphInputHelp =
    graphInputs.length === 0
      ? "No accepted inputs are advertised as graph-connectable for this node."
      : `Graph-connectable inputs: ${formatArtifactLabels(graphInputs)}. Use matching typed ports when a compatible upstream node produces them.`;
  const manualInputHelp =
    manualInputs.length === 0
      ? "No manual or local-only accepted inputs are required for this node."
      : `Manual/local context-only inputs: ${formatArtifactLabels(manualInputs)}. Add these through the inspector, asset picker, local project state, or node-specific controls.`;

  return {
    acceptedInputs:
      contract.acceptedInputs.length === 0
        ? "No upstream artifacts are required; start here with local notes, free text, or manual direction."
        : `Accepted inputs: ${formatArtifactLabels(contract.acceptedInputs)}. ${graphInputHelp} ${manualInputHelp}`,
    producedOutputs: `Produced outputs: ${formatArtifactLabels(contract.producedOutputs)}. Downstream nodes can consume these artifacts through typed ports and run previews.`,
    primaryAction: `Primary action: ${contract.runLabel}. ${
      contract.runnable
        ? "Preview the run scope first, then execute this node when the connected inputs are ready."
        : "Use this node to prepare context for connected runnable nodes."
    }`,
    useCase,
    graphInputs,
    manualInputs,
    graphInputHelp,
    manualInputHelp
  };
}

function createPorts(
  artifactKinds: ContractArtifactKind[],
  direction: ContractPortDirection,
  requiredArtifacts: ContractArtifactKind[] = []
): ContractPort[] {
  const required = new Set(requiredArtifacts);

  return artifactKinds.map((artifactKind) => ({
    id: artifactKind,
    label: artifactLabels[artifactKind],
    artifactKind,
    direction,
    required: required.has(artifactKind),
    description:
      direction === "input"
        ? inputDescriptions[artifactKind]
        : `Produces ${artifactLabels[artifactKind].toLowerCase()} artifacts for downstream nodes.`
  }));
}

function withPorts(
  draft: NodeContractDraft,
  requiredInputs: ContractArtifactKind[] = [],
  requiredOutputs: ContractArtifactKind[] = draft.producedOutputs.slice(0, 1)
): NodeContract {
  const contract: NodeContractCore = {
    definitionId: draft.definitionId,
    acceptedInputs: draft.acceptedInputs,
    producedOutputs: draft.producedOutputs,
    acceptedChannels: draft.acceptedChannels,
    producedChannels: draft.producedChannels,
    runnable: draft.runnable,
    runLabel: draft.runLabel,
    description: draft.description
  };
  const inputClassification = createInputClassification(draft);

  return {
    ...contract,
    help: createHelp(contract, draft.useCase, inputClassification),
    inputPorts: createPorts(contract.acceptedInputs, "input", requiredInputs),
    outputPorts: createPorts(contract.producedOutputs, "output", requiredOutputs)
  };
}

function promptContract(definition: EtherNodeDefinition): NodeContract {
  const isPromptHelper = definition.subtype !== "Prompt";

  return withPorts({
    definitionId: definition.id,
    acceptedInputs: ["prompt", "text", "reference", "metadata", "note"],
    producedOutputs: isPromptHelper ? ["text", "prompt", "metadata"] : ["prompt", "metadata"],
    acceptedChannels: PROMPT_CHANNELS,
    producedChannels: PROMPT_CHANNELS,
    runnable: true,
    runLabel: "Assemble Prompt",
    description: `${definition.title} assembles editable text and structured context into prompt material.`,
    graphInputs: ["prompt", "text", "metadata"],
    manualInputs: ["reference", "note"],
    useCase: isPromptHelper
      ? "Use it to brainstorm, expand, mutate, or reinforce prompt material before committing it to generation."
      : "Use it to build one focused prompt section that can be reused, mutated, and connected into generation."
  });
}

function referenceContract(definition: EtherNodeDefinition): NodeContract {
  const artifactInputsBySubtype: Record<string, ContractArtifactKind[]> = {
    "Video Reference": ["video", "metadata", "text", "note"],
    "Audio Reference": ["audio", "metadata", "text", "note"]
  };
  const artifactOutputsBySubtype: Record<string, ContractArtifactKind[]> = {
    "Video Reference": ["video", "metadata", "text"],
    "Audio Reference": ["audio", "metadata", "text"]
  };
  const channelsBySubtype: Record<string, { accepted: PayloadChannel[]; produced: PayloadChannel[] }> = {
    "Video Reference": {
      accepted: ["video", "data", "text"],
      produced: ["video", "data", "text"]
    },
    "Audio Reference": {
      accepted: ["audio", "data", "text"],
      produced: ["audio", "data", "text"]
    },
    Image: {
      accepted: TEXT_IMAGE_DATA_CHANNELS,
      produced: IMAGE_DATA_CHANNELS
    },
    "Colour Grid": {
      accepted: TEXT_IMAGE_DATA_CHANNELS,
      produced: IMAGE_DATA_CHANNELS
    },
    Moodboard: {
      accepted: TEXT_IMAGE_DATA_CHANNELS,
      produced: IMAGE_DATA_CHANNELS
    }
  };
  const channels = channelsBySubtype[definition.subtype] ?? {
    accepted: TEXT_IMAGE_DATA_CHANNELS,
    produced: IMAGE_DATA_CHANNELS
  };
  const acceptedInputs = artifactInputsBySubtype[definition.subtype] ?? ["image", "metadata", "text", "note"];
  const producedOutputs = artifactOutputsBySubtype[definition.subtype] ?? ["reference", "metadata"];

  return withPorts({
    definitionId: definition.id,
    acceptedInputs,
    producedOutputs,
    acceptedChannels: channels.accepted,
    producedChannels: channels.produced,
    runnable: false,
    runLabel: "Resolve Reference",
    description: `${definition.title} prepares a role-labeled reference artifact for downstream nodes.`,
    graphInputs: ["note"],
    manualInputs: acceptedInputs.filter((input) => input !== "note"),
    useCase: "Use it to anchor subject, style, setting, product, face, lighting, or palette guidance without baking it into prompt text."
  });
}

function editContract(definition: EtherNodeDefinition): NodeContract {
  return withPorts({
    definitionId: definition.id,
    acceptedInputs: ["image", "prompt", "negativePrompt", "reference", "mask", "metadata", "note"],
    producedOutputs: ["editedImage", "mask", "metadata"],
    acceptedChannels: EDIT_CHANNELS,
    producedChannels: ["image", "mask", "data"],
    runnable: true,
    runLabel: definition.subtype === "Upscale" ? "Upscale" : "Run Edit",
    description: `${definition.title} executes a provider or local edit path and stores edited image lineage.`,
    graphInputs: ["image", "prompt", "reference", "mask", "metadata"],
    manualInputs: ["negativePrompt", "note"],
    useCase:
      definition.subtype === "Upscale"
        ? "Use it to preserve a selected image while creating a cleaner, larger, or more delivery-ready derivative."
        : "Use it to revise an image with masks, references, and prompts while keeping lineage connected to the source."
  }, ["image"]);
}

function reviewContract(definition: EtherNodeDefinition): NodeContract {
  const producedOutputs: Record<string, ContractArtifactKind[]> = {
    Compare: ["compare", "metadata", "text"],
    Evaluation: ["evaluation", "metadata", "text"],
    Filter: ["filterRule", "route", "metadata", "text"]
  };

  return withPorts({
    definitionId: definition.id,
    acceptedInputs: [
      "image",
      "editedImage",
      "collection",
      "metadata",
      "reference",
      "prompt",
      "text",
      "compare",
      "evaluation",
      "filterRule"
    ],
    producedOutputs: producedOutputs[definition.subtype] ?? ["metadata", "text"],
    acceptedChannels: REVIEW_INPUT_CHANNELS,
    producedChannels: REVIEW_OUTPUT_CHANNELS,
    runnable: true,
    runLabel:
      definition.subtype === "Compare"
        ? "Compare"
        : definition.subtype === "Evaluation"
          ? "Evaluate"
          : "Filter",
    description: `${definition.title} reviews, evaluates, or routes local artifacts.`,
    graphInputs: [
      "image",
      "editedImage",
      "collection",
      "metadata",
      "reference",
      "prompt",
      "text",
      "compare",
      "evaluation",
      "filterRule"
    ],
    useCase:
      definition.subtype === "Compare"
        ? "Use it to review multiple candidate images, record a winner, and pass structured comparison notes downstream."
        : definition.subtype === "Evaluation"
          ? "Use it to score or threshold outputs against review criteria before routing or archiving them."
          : "Use it to route artifacts into pass, needs-edit, or reject lanes without losing the audit trail."
  });
}

function storeContract(definition: EtherNodeDefinition): NodeContract {
  const producedOutputs: Record<string, ContractArtifactKind[]> = {
    Directory: ["route", "metadata"],
    Collection: ["collection", "metadata"]
  };

  return withPorts({
    definitionId: definition.id,
    acceptedInputs: [
      "image",
      "editedImage",
      "collection",
      "metadata",
      "reference",
      "prompt",
      "negativePrompt",
      "compare",
      "evaluation",
      "filterRule",
      "text"
    ],
    producedOutputs: producedOutputs[definition.subtype] ?? ["metadata"],
    acceptedChannels: ALL_CHANNELS,
    producedChannels: ALL_CHANNELS,
    runnable: true,
    runLabel: "Organize",
    description: `${definition.title} organizes local artifacts and routing destinations.`,
    graphInputs: [
      "image",
      "editedImage",
      "collection",
      "metadata",
      "reference",
      "prompt",
      "compare",
      "evaluation",
      "filterRule",
      "text"
    ],
    manualInputs: ["negativePrompt"],
    useCase:
      definition.subtype === "Collection"
        ? "Use it to gather approved artifacts into a named local collection for later browsing and delivery."
        : "Use it to mirror artifacts into a project directory while keeping metadata connected to the graph."
  });
}

function generationContract(definition: EtherNodeDefinition): NodeContract {
  return withPorts({
    definitionId: definition.id,
    acceptedInputs: ["prompt", "negativePrompt", "reference", "metadata", "text"],
    producedOutputs: ["image", "metadata", "text"],
    acceptedChannels: TEXT_IMAGE_DATA_CHANNELS,
    producedChannels: ["image", "data", "text"],
    runnable: true,
    runLabel: "Generate",
    description: `${definition.title} assembles inputs, executes a configured image provider, and stores output lineage.`,
    graphInputs: ["prompt", "reference", "metadata", "text"],
    manualInputs: ["negativePrompt"],
    useCase: "Use it to turn assembled prompts and references into generated image artifacts with provider metadata."
  }, ["prompt"]);
}

function noteContract(definition: EtherNodeDefinition): NodeContract {
  return withPorts({
    definitionId: definition.id,
    acceptedInputs: [],
    producedOutputs: ["note", "text", "metadata"],
    acceptedChannels: [],
    producedChannels: NOTE_OUTPUT_CHANNELS,
    runnable: false,
    runLabel: "Review",
    description: `${definition.title} stores visual or textual context for connected nodes.`,
    useCase: "Use it to keep human notes, sketches, acceptance reminders, or review observations connected to the workflow."
  });
}

function createContract(definition: EtherNodeDefinition): NodeContract {
  switch (definition.category) {
    case "Prompt":
      return promptContract(definition);
    case "Reference":
      return referenceContract(definition);
    case "Edit":
      return editContract(definition);
    case "Review":
      return reviewContract(definition);
    case "Store":
      return storeContract(definition);
    case "Generation":
      return generationContract(definition);
    case "Note":
      return noteContract(definition);
    default:
      throw new Error(`Unsupported node category for contract: ${definition.category}`);
  }
}

export const NODE_CONTRACTS: NodeContract[] = NODE_DEFINITIONS.map(createContract);

export function getNodeContract(definitionId: string) {
  const contract = NODE_CONTRACTS.find((candidate) => candidate.definitionId === definitionId);

  if (!contract) {
    throw new Error(`Unknown node contract: ${definitionId}`);
  }

  return contract;
}

export function getOptionalNodeContract(definitionId: unknown) {
  if (typeof definitionId !== "string") {
    return null;
  }

  return NODE_CONTRACTS.find((candidate) => candidate.definitionId === definitionId) ?? null;
}
