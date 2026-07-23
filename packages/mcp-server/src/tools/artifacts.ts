import { z } from "zod";

import { applicationQuery } from "../applicationAdapter.js";
import { ArtifactSearchInputSchema, EmptyInputSchema, NonEmptyIdSchema } from "../schemas.js";
import type { EtherToolDefinition } from "../toolTypes.js";
import { readOnlyAnnotations } from "../toolTypes.js";

export const artifactTools: EtherToolDefinition[] = [
  {
    name: "ether.reference.list",
    description: "List embedded, linked, missing, or relinking references in the active document.",
    inputSchema: z.object({ state: z.enum(["linked", "embedded", "missing", "relinking"]).optional() }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "reference.list", input);
    }
  },
  {
    name: "ether.reference.inspect",
    description: "Inspect one reference and its portability state.",
    inputSchema: z.object({ referenceId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "reference.detail", input);
    }
  },
  {
    name: "ether.artifact.search",
    description: "Search the durable artifact library with typed filters and pagination.",
    inputSchema: ArtifactSearchInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      const parsed = ArtifactSearchInputSchema.parse(input);
      return applicationQuery(application, "artifact.search", parsed);
    }
  },
  {
    name: "ether.artifact.inspect",
    description: "Inspect one artifact, metadata, review state, and durable source identity.",
    inputSchema: z.object({ artifactId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "artifact.detail", input);
    }
  },
  {
    name: "ether.artifact.lineage",
    description: "Inspect immutable artifact lineage through accepted output versions.",
    inputSchema: z.object({ artifactId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "artifact.lineage", input);
    }
  },
  {
    name: "ether.collection.list",
    description: "List durable collections in the active document.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }) {
      return applicationQuery(application, "collection.list", {});
    }
  }
];
