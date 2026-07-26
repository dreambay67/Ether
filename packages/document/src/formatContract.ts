import { createHash } from "node:crypto";
import { canonicalJson } from "@ether/schema";
import { ETHER_PAGE_SIZE } from "./format.js";

export const ETHER_4_CHANNELS = ["text", "image", "mask", "data", "video", "audio"] as const;
export const ETHER_4_ROLES = ["general", "negative", "subject", "product", "face", "clothing", "pose", "setting", "composition", "style", "lighting", "colourPalette", "typography", "motion", "timing"] as const;
export const ETHER_4_CANONICAL_NODES = ["prompt.text", "prompt.worker", "reference.set", "generation.image", "edit.image", "edit.mask", "edit.transform", "review.compare", "review.evaluate", "review.filter", "flow.variables", "flow.batch", "flow.join", "output.collection", "output.export", "canvas.note", "canvas.drawing"] as const;

export const ETHER_4_GRAPH_TRANSACTION_CONTRACT = Object.freeze({
  strict: true,
  fields: ["id", "baseDocumentRevisionId", "baseGraphRevisions", "title", "actor", "operations", "layoutPolicy"],
  actors: ["user", "codex", "recipe", "system"],
  layoutPolicies: ["preserve", "tidy-affected", "layout-branch"],
  operations: ["addNode", "updateNode", "removeNode", "addEdge", "updateEdge", "removeEdge", "moveNodes", "resizeNodes", "createGroup", "updateGroup", "removeGroup", "createModule", "updateModule", "removeModule", "updateModuleInterface", "updateGraphProperties"]
} as const);

export const ETHER_4_DOCUMENT_TRANSACTION_CONTRACT = Object.freeze({
  sqliteBegin: "BEGIN IMMEDIATE",
  journalMode: "DELETE",
  synchronous: "FULL",
  atomicUnit: ["graph revisions", "document revision", "head update", "milestone", "outbox events"],
  replayIdentity: ["commandId", "commandKind"],
  durableSaveStates: ["saving", "saved", "needs-attention"]
} as const);

export const ETHER_4_RECIPE_MANIFEST_CONTRACT = Object.freeze({
  strict: true,
  fields: ["id", "version", "title", "description", "parameters", "graph", "moduleGraphs", "capabilityRequirements", "substitutions", "layout", "checkpoints", "expectedWork", "acceptanceScenario"],
  parameterTypes: ["string", "number", "boolean", "choice", "artifact"],
  graphKinds: ["root", "module"]
} as const);

function contractHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export const ETHER_4_GRAPH_TRANSACTION_CONTRACT_HASH = contractHash(ETHER_4_GRAPH_TRANSACTION_CONTRACT);
export const ETHER_4_DOCUMENT_TRANSACTION_CONTRACT_HASH = contractHash(ETHER_4_DOCUMENT_TRANSACTION_CONTRACT);
export const ETHER_4_RECIPE_MANIFEST_CONTRACT_HASH = contractHash(ETHER_4_RECIPE_MANIFEST_CONTRACT);

export const ETHER_4_FORMAT_CONTRACT = Object.freeze({
  applicationId: 0x45544852,
  canonicalNodes: ETHER_4_CANONICAL_NODES,
  channels: ETHER_4_CHANNELS,
  documentTransactionHash: ETHER_4_DOCUMENT_TRANSACTION_CONTRACT_HASH,
  formatMarker: "ETHERDOC",
  formatVersion: "4.0.0",
  graphTransactionHash: ETHER_4_GRAPH_TRANSACTION_CONTRACT_HASH,
  pageSize: ETHER_PAGE_SIZE,
  recipeManifestHash: ETHER_4_RECIPE_MANIFEST_CONTRACT_HASH,
  roles: ETHER_4_ROLES,
  schemaVersion: 40000
} as const);
