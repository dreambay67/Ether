import { NODE_DEFINITIONS, type EtherNodeDefinition } from "./nodeCatalog.js";

export type ContractArtifactKind =
  | "prompt"
  | "negativePrompt"
  | "reference"
  | "image"
  | "mask"
  | "metadata"
  | "collection"
  | "note"
  | "evaluation"
  | "filterRule"
  | "editedImage"
  | "text"
  | "route";

export type NodeContract = {
  definitionId: string;
  acceptedInputs: ContractArtifactKind[];
  producedOutputs: ContractArtifactKind[];
  runnable: boolean;
  runLabel: string;
  description: string;
};

function promptContract(definition: EtherNodeDefinition): NodeContract {
  const isNegative = definition.subtype === "Negative";

  return {
    definitionId: definition.id,
    acceptedInputs: ["prompt", "text", "reference", "note"],
    producedOutputs: [isNegative ? "negativePrompt" : "prompt"],
    runnable: true,
    runLabel: "Assemble Prompt",
    description: `${definition.title} assembles editable text into a ${
      isNegative ? "negative constraint" : "prompt section"
    } artifact.`
  };
}

function referenceContract(definition: EtherNodeDefinition): NodeContract {
  return {
    definitionId: definition.id,
    acceptedInputs: ["image", "metadata", "note"],
    producedOutputs: ["reference", "metadata"],
    runnable: false,
    runLabel: "Resolve Reference",
    description: `${definition.title} prepares a role-labeled reference artifact for downstream nodes.`
  };
}

function editContract(definition: EtherNodeDefinition): NodeContract {
  return {
    definitionId: definition.id,
    acceptedInputs: ["image", "prompt", "negativePrompt", "reference", "mask", "note"],
    producedOutputs: ["editedImage", "mask", "metadata"],
    runnable: true,
    runLabel: definition.subtype === "Upscale" ? "Upscale" : "Run Edit",
    description: `${definition.title} executes a provider or local edit path and stores edited image lineage.`
  };
}

function storeContract(definition: EtherNodeDefinition): NodeContract {
  const producedOutputs: Record<string, ContractArtifactKind[]> = {
    Directory: ["route", "metadata"],
    Collection: ["collection", "metadata"],
    Compare: ["evaluation", "metadata"],
    Evaluate: ["evaluation", "metadata"],
    Filter: ["filterRule", "route"]
  };

  return {
    definitionId: definition.id,
    acceptedInputs: [
      "image",
      "editedImage",
      "collection",
      "metadata",
      "reference",
      "prompt",
      "negativePrompt",
      "evaluation",
      "filterRule"
    ],
    producedOutputs: producedOutputs[definition.subtype] ?? ["metadata"],
    runnable: false,
    runLabel:
      definition.subtype === "Compare" || definition.subtype === "Evaluate"
        ? "Review"
        : definition.subtype === "Filter"
          ? "Route"
          : "Organize",
    description: `${definition.title} organizes, reviews, evaluates, or routes local artifacts.`
  };
}

function assistantContract(definition: EtherNodeDefinition): NodeContract {
  return {
    definitionId: definition.id,
    acceptedInputs: ["prompt", "negativePrompt", "reference", "metadata", "note", "text"],
    producedOutputs: ["text", "prompt", "metadata"],
    runnable: false,
    runLabel: "Prepare Assistant Text",
    description: `${definition.title} prepares editable assistant text for later workflow stages.`
  };
}

function generationContract(definition: EtherNodeDefinition): NodeContract {
  return {
    definitionId: definition.id,
    acceptedInputs: ["prompt", "negativePrompt", "reference", "metadata"],
    producedOutputs: ["image", "metadata", "prompt"],
    runnable: true,
    runLabel: "Generate",
    description: `${definition.title} assembles inputs, executes a configured image provider, and stores output lineage.`
  };
}

function noteContract(definition: EtherNodeDefinition): NodeContract {
  return {
    definitionId: definition.id,
    acceptedInputs: [],
    producedOutputs: ["note", "text"],
    runnable: false,
    runLabel: "Review",
    description: `${definition.title} stores visual or textual context for connected nodes.`
  };
}

function createContract(definition: EtherNodeDefinition): NodeContract {
  switch (definition.category) {
    case "Prompt":
      return promptContract(definition);
    case "Reference":
      return referenceContract(definition);
    case "Edit":
      return editContract(definition);
    case "Store":
      return storeContract(definition);
    case "Assistant":
      return assistantContract(definition);
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
