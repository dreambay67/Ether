import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import type { DocumentStore } from "@ether/document";
import { validateFullGraphState } from "@ether/graph-kernel";
import type { GenerationProvider } from "@ether/providers";
import { BUILTIN_RECIPES, inspectRecipeProviderSetup, instantiateRecipe, recipeById } from "@ether/recipes";
import {
  ApplicationCommandResponseSchema,
  ApplicationQueryResponseSchema,
  type ApplicationCommand,
  type ApplicationCommandResponse,
  type ApplicationQuery,
  type ApplicationQueryResponse,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type ProviderCapability,
  type ProviderHealthResult
} from "@ether/schema";

import type { EtherApplication } from "./application.js";

type CommandResponse = ApplicationCommandResponse;
type QueryResponse = ApplicationQueryResponse;

class BoundaryUnavailableError extends Error {
  readonly code = "EXTERNAL_CAPABILITY_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "BoundaryUnavailableError";
  }
}

function commandResponse(command: ApplicationCommand, payload: unknown): CommandResponse {
  return ApplicationCommandResponseSchema.parse({
    kind: "response",
    id: randomUUID(),
    correlationId: command.correlationId,
    requestId: command.id,
    name: command.name,
    ...("documentId" in command ? { documentId: command.documentId } : {}),
    payload
  });
}

function queryResponse(query: ApplicationQuery, payload: unknown): QueryResponse {
  return ApplicationQueryResponseSchema.parse({
    kind: "response",
    id: randomUUID(),
    correlationId: query.correlationId,
    requestId: query.id,
    name: query.name,
    ...("documentId" in query ? { documentId: query.documentId } : {}),
    payload
  });
}

function assertDocument(command: ApplicationCommand | ApplicationQuery, store: DocumentStore): void {
  if ("documentId" in command && command.documentId !== store.documentId) {
    const error = new Error("The request targets a different Ether document.") as Error & { code: string };
    error.code = "DOCUMENT_SCOPE_MISMATCH";
    throw error;
  }
}

function acknowledgement() {
  return { kind: "acknowledgement" as const, accepted: true as const };
}

function revisionPayload(result: { documentRevisionId: string; graphRevisions: Record<string, string> }) {
  return {
    kind: "revision" as const,
    documentRevisionId: result.documentRevisionId,
    graphRevisions: Object.entries(result.graphRevisions).map(([graphId, revisionId]) => ({ graphId, revisionId }))
  };
}

function responseFromSaved(value: Record<string, unknown>, key: string): unknown {
  const result = value[key];
  if (result === undefined) {
    const error = new Error("Stored command result is incomplete.") as Error & { code: string };
    error.code = "COMMAND_RESULT_CORRUPT";
    throw error;
  }
  return result;
}

async function commandOnce(
  app: EtherApplication,
  command: ApplicationCommand,
  payloadKey: string,
  run: (repositories: Parameters<DocumentStore["transaction"]>[0] extends (repositories: infer R) => unknown ? R : never) => unknown,
  events: ReadonlyArray<{ name: string; payload: Record<string, unknown> }> = []
): Promise<unknown> {
  const store = app.boundaryStore();
  assertDocument(command, store);
  return store.transaction((repositories) => {
    const existing = repositories.execution.getCommandResult(command.id, command.name);
    if (existing !== undefined) return responseFromSaved(existing, payloadKey);
    const result = run(repositories as never);
    repositories.execution.completeCommand(command.id, command.name, { [payloadKey]: result }, events as never);
    return result;
  });
}

function outputPayload(version: NodeOutputVersion, payload: Record<string, unknown>, relation: "manual-edit" | "restored"): PayloadEnvelope {
  const id = `payload-${randomUUID()}`;
  return {
    id,
    channel: "data",
    role: "general",
    content: { kind: "object", value: payload as never },
    source: { nodeId: version.nodeId, outputVersionId: `output-${randomUUID()}`, lineageKey: relation },
    metadata: { manual: true }
  };
}

function manualOutput(
  parent: NodeOutputVersion,
  payload: PayloadEnvelope,
  relation: "manual-edit" | "restored"
): NodeOutputVersion {
  const now = new Date().toISOString();
  const id = payload.source.outputVersionId;
  return {
    ...parent,
    id,
    inputPayloadIds: [...parent.outputPayloadIds],
    outputPayloadIds: [payload.id],
    parentOutputVersionId: parent.id,
    lineage: {
      parentOutputVersionId: parent.id,
      rootOutputVersionId: parent.lineage?.rootOutputVersionId ?? parent.id,
      relation
    },
    producer: { kind: "manual", actor: "user" },
    approval: { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: now, completedAt: now },
    failure: null,
    createdAt: now
  };
}

async function providerHealth(provider: GenerationProvider): Promise<ProviderHealthResult> {
  const diagnostic = await provider.diagnose();
  return {
    providerId: diagnostic.id,
    status: diagnostic.availability === "available" ? "available" : "unavailable",
    message: diagnostic.messages.join(" ") || null,
    checkedAt: new Date().toISOString()
  };
}

async function providerCapabilities(provider: GenerationProvider): Promise<ProviderCapability[]> {
  const diagnostic = await provider.diagnose();
  const profiles = (diagnostic.profiles ?? []).flatMap((profile) => {
    if (profile.availability !== "available" || profile.status !== "ready") return [];
    if (profile.operation !== "image.generate" && profile.operation !== "image.edit") return [];
    return [{
      providerId: profile.providerId,
      profileId: profile.profileId,
      operation: profile.operation === "image.generate" ? "generate-image" : "edit-image",
      inputChannels: [...profile.inputChannels],
      outputChannels: [...profile.outputChannels],
      aspectRatios: [],
      resolutions: [],
      maxReferences: profile.mediaLimits?.maxInputs ?? (profile.inputChannels.includes("image") ? 1 : 0),
      maxOutputsPerCall: 1,
      ...(profile.maxParallelism === undefined ? {} : { maxParallelism: profile.maxParallelism }),
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "runtime-discovered",
      limitations: profile.messages ?? []
    } satisfies ProviderCapability];
  });
  if (profiles.length > 0 || diagnostic.availability !== "available") return profiles;
  const profileId = diagnostic.route === "local-fake" ? "fake-image-default" : "default";
  const fallback: ProviderCapability[] = [];
  const base = {
    providerId: diagnostic.id, profileId, aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 32,
    supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered" as const, limitations: diagnostic.messages
  };
  if (diagnostic.capabilities.includes("image.generate")) fallback.push({
    ...base, operation: "generate-image", inputChannels: ["text", "image", "data"], outputChannels: ["image"]
  });
  if (diagnostic.capabilities.includes("image.edit")) fallback.push({
    ...base, operation: "edit-image", inputChannels: ["text", "image", "mask", "data"], outputChannels: ["image"]
  });
  return fallback;
}

async function recipeCapabilities(app: EtherApplication): Promise<ProviderCapability[]> {
  let discovered: ProviderCapability[] = [];
  try {
    discovered = await providerCapabilities(app.boundaryProvider());
  } catch {
    // Recipe blockers should name the missing capability even when provider
    // diagnosis itself is unavailable.
  }
  const execution = app.boundaryExecutionProviderAvailability();
  const intelligence: ProviderCapability[] = [
    ...(execution.worker ? [{
      providerId: "ether-intelligence", profileId: "worker", operation: "llm" as const,
      inputChannels: ["text", "image", "data"] as ProviderCapability["inputChannels"], outputChannels: ["text"] as ProviderCapability["outputChannels"],
      aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 4,
      supportsCancellation: true, supportsSeed: false, provenance: "static-constraint" as const, limitations: []
    }] : []),
    ...(execution.evaluation ? [{
      providerId: "ether-intelligence", profileId: "evaluation", operation: "llm" as const,
      inputChannels: ["text", "image", "data"] as ProviderCapability["inputChannels"], outputChannels: ["data"] as ProviderCapability["outputChannels"],
      aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 4,
      supportsCancellation: true, supportsSeed: false, provenance: "static-constraint" as const, limitations: []
    }] : [])
  ];
  const combined = [...app.boundaryConfiguredProviderCapabilities(), ...discovered, ...intelligence];
  return combined.filter((capability, index) => combined.findIndex((candidate) =>
    candidate.providerId === capability.providerId
    && candidate.profileId === capability.profileId
    && candidate.operation === capability.operation
  ) === index);
}

function requireRecipe(recipeId: string, version: string) {
  const recipe = recipeById(recipeId, version);
  if (recipe !== undefined) return recipe;
  const error = new Error(`Recipe ${recipeId}@${version} is not installed.`) as Error & { code: string };
  error.code = "RECIPE_NOT_FOUND";
  throw error;
}

function recipeBlocked(blockers: readonly { code: string; message: string }[]): never {
  const error = new Error(blockers.map((blocker) => blocker.message).join(" ")) as Error & { code: string };
  error.code = blockers.some((blocker) => blocker.code === "CAPABILITY_MISSING")
    ? "RECIPE_CAPABILITY_BLOCKED"
    : "RECIPE_SETUP_BLOCKED";
  throw error;
}

export async function executeApplicationCommand(
  app: EtherApplication,
  command: ApplicationCommand
): Promise<CommandResponse> {
  const store = app.boundaryStore();
  if ("documentId" in command) assertDocument(command, store);

  switch (command.name) {
    case "document.save":
      await app.saveDocument({ commandId: command.id });
      return commandResponse(command, acknowledgement());
    case "document.close":
      await app.closeDocument();
      return commandResponse(command, acknowledgement());
    case "document.compact":
      await app.compactDocument();
      return commandResponse(command, acknowledgement());
    case "document.saveAs":
    case "document.saveCopy":
    case "document.new":
    case "document.open":
    case "document.recover":
      throw new BoundaryUnavailableError("Document location grants are resolved by the desktop shell and are not attached to this application instance.");
    case "graph.applyTransaction": {
      const result = await app.applyGraphTransaction({ commandId: command.id, transaction: command.payload.transaction });
      return commandResponse(command, revisionPayload(result));
    }
    case "graph.undo":
    case "graph.redo":
      return commandResponse(command, revisionPayload(await app.applyHistory(command.id, command.name)));
    case "graph.validate": {
      const graphs = await store.read(({ graphs }) => graphs.list());
      const issues = validateFullGraphState(graphs).map((issue) => ({
        code: issue.code, message: issue.message, nodeId: issue.entityId ?? null, edgeId: issue.entityId ?? null
      }));
      return commandResponse(command, { valid: issues.length === 0, issues });
    }
    case "run.preview":
      return commandResponse(command, { plan: await app.previewRun({ commandId: command.id, ...command.payload }) });
    case "run.start":
      return commandResponse(command, { job: await app.startRun({ commandId: command.id, ...command.payload }) });
    case "run.cancel":
    case "job.cancel":
      await app.cancelRun({ commandId: command.id, jobId: command.payload.jobId });
      return commandResponse(command, acknowledgement());
    case "run.retry":
    case "job.retry":
      await app.retryRun({ commandId: command.id, jobId: command.payload.jobId, workItemIds: command.payload.workItemIds });
      return commandResponse(command, acknowledgement());
    case "run.resume":
    case "job.resume":
      await app.resumeRun({ commandId: command.id, jobId: command.payload.jobId });
      return commandResponse(command, acknowledgement());
    case "permission.grantRun": {
      const permit = await app.grantRunPermit({ commandId: command.id, ...command.payload });
      return commandResponse(command, { permitId: permit.id, permission: "run", expiresAt: null });
    }
    case "permission.grantEdit": {
      const permit = await app.grantEditPermit(command.id, command.payload.expiresAt ?? null);
      return commandResponse(command, { permitId: permit.id, permission: "edit", expiresAt: permit.expiresAt });
    }
    case "permission.grantPath": {
      const permit = await app.grantPathPermit(command.id, command.payload.pathGrantId, command.payload.purpose);
      return commandResponse(command, { permitId: permit.id, permission: "path", expiresAt: null });
    }
    case "permission.revoke":
      app.revokePermit(command.payload.permitId);
      return commandResponse(command, acknowledgement());
    case "output.edit": {
      const output = await commandOnce(app, command, "output", (repositories) => {
        const parent = repositories.outputs.getVersion(command.payload.outputVersionId);
        if (parent === undefined) throw new Error(`Unknown output ${command.payload.outputVersionId}.`);
        const payload = outputPayload(parent, command.payload.payload, "manual-edit");
        return repositories.outputs.createManualEdit(manualOutput(parent, payload, "manual-edit"), [payload]);
      }, [{ name: "output.created", payload: { outputVersionId: command.payload.outputVersionId, parentOutputVersionId: command.payload.outputVersionId } }]);
      return commandResponse(command, { outputVersion: output });
    }
    case "editWorkspace.commit":
      return commandResponse(command, await app.commitEditWorkspace({ commandId: command.id, ...command.payload }));
    case "output.restore": {
      const output = await commandOnce(app, command, "output", (repositories) => {
        const parent = repositories.outputs.getVersion(command.payload.outputVersionId);
        if (parent === undefined) throw new Error(`Unknown output ${command.payload.outputVersionId}.`);
        const payload = outputPayload(parent, { restoredOutputVersionId: parent.id, note: command.payload.note ?? "" }, "restored");
        return repositories.outputs.restore(manualOutput(parent, payload, "restored"), [payload]);
      });
      return commandResponse(command, { outputVersion: output });
    }
    case "output.pin":
      return commandResponse(command, revisionPayload(await app.pinOutput({ commandId: command.id, ...command.payload })));
    case "review.approve":
    case "review.reject": {
      const state = command.name === "review.approve" && command.payload.approved ? "approved" : "rejected";
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.outputs.appendReview({
          outputVersionId: command.payload.outputVersionId,
          state,
          actor: "user",
          ...(command.name === "review.reject" ? { reason: command.payload.reason } : {})
        });
        return acknowledgement();
      }, [{ name: "output.reviewed", payload: { outputVersionId: command.payload.outputVersionId, approval: { state, actor: "user", at: new Date().toISOString() } } }]);
      return commandResponse(command, acknowledgement());
    }
    case "collection.create": {
      const collection = await commandOnce(app, command, "collection", (repositories) => repositories.collections.create({
        id: `collection-${randomUUID()}`,
        title: command.payload.title,
        description: command.payload.description ?? "",
        primary: command.payload.primary ?? false
      }), [{ name: "collection.changed", payload: { collectionId: "created", change: "created" } }]);
      return commandResponse(command, { collection });
    }
    case "collection.update": {
      const collection = await commandOnce(app, command, "collection", (repositories) => repositories.collections.update(
        command.payload.collectionId,
        command.payload
      ));
      return commandResponse(command, { collection });
    }
    case "collection.delete":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        if (!repositories.collections.remove(command.payload.collectionId)) throw new Error(`Unknown collection ${command.payload.collectionId}.`);
        return acknowledgement();
      });
      return commandResponse(command, acknowledgement());
    case "collection.addMembers":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.collections.addMembers(command.payload.collectionId, command.payload.members.map((member) => ({
          ...member,
          source: { commandId: command.id }
        })));
        return acknowledgement();
      });
      return commandResponse(command, acknowledgement());
    case "collection.removeMembers":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.collections.removeMembers(command.payload.collectionId, command.payload.artifactIds);
        return acknowledgement();
      });
      return commandResponse(command, acknowledgement());
    case "collection.setPrimary": {
      const collection = await commandOnce(app, command, "collection", (repositories) => repositories.collections.setPrimary(command.payload.collectionId));
      return commandResponse(command, { collection });
    }
    case "review.route":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.collections.addMembers(command.payload.collectionId, [{
          artifactId: command.payload.artifactId,
          role: command.payload.role,
          source: { commandId: command.id }
        }]);
        return acknowledgement();
      });
      return commandResponse(command, acknowledgement());
    case "review.rate":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.artifacts.rate(command.payload.artifactId, command.payload.rating, "user");
        return acknowledgement();
      }, [{ name: "artifact.changed", payload: { artifactId: command.payload.artifactId, change: "rated" } }]);
      return commandResponse(command, acknowledgement());
    case "review.tag":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.artifacts.setTags(command.payload.artifactId, command.payload.tags);
        return acknowledgement();
      }, [{ name: "artifact.changed", payload: { artifactId: command.payload.artifactId, change: "tagged" } }]);
      return commandResponse(command, acknowledgement());
    case "review.completeCompare":
      await app.completeCompare({ commandId: command.id, ...command.payload });
      return commandResponse(command, acknowledgement());
    case "reference.link": {
      const reference = await app.linkDocumentReference(command.payload);
      return commandResponse(command, { referenceId: reference.id });
    }
    case "reference.relink": {
      const reference = await app.relinkDocumentReferenceGrant(command.payload.referenceId, command.payload.pathGrantId);
      return commandResponse(command, { referenceId: reference.id });
    }
    case "reference.assignToSet":
      await app.assignReferenceSet(command.payload.nodeId, command.payload.members, command.payload.replace ?? false);
      return commandResponse(command, acknowledgement());
    case "reference.embed":
      await app.embedAvailableReference(command.payload.referenceId);
      return commandResponse(command, { referenceId: command.payload.referenceId });
    case "reference.remove":
      await app.removeDocumentReference(command.payload.referenceId);
      return commandResponse(command, acknowledgement());
    case "graph.layout":
    case "provider.configure":
    case "provider.disable":
    case "recipe.install":
    case "recipe.remove":
      throw new BoundaryUnavailableError(`${command.name} needs the corresponding desktop, recipe, or Live Output service injection.`);
    case "recipe.preview": {
      const manifest = requireRecipe(command.payload.recipeId, command.payload.version);
      const snapshot = await store.read(({ graphs, revisions }) => ({ graphs: graphs.list(), head: revisions.head() }));
      const target = snapshot.graphs.filter((graph) => graph.kind === "root").sort((left, right) => left.id.localeCompare(right.id))[0];
      if (target === undefined) recipeBlocked([{ code: "TARGET_GRAPH_MISSING", message: "This document has no root graph for recipe preview." }]);
      const result = instantiateRecipe({
        manifest,
        graphs: snapshot.graphs,
        targetGraphId: target.id,
        baseDocumentRevisionId: snapshot.head.documentRevisionId,
        baseGraphRevisions: snapshot.head.graphRevisions,
        parameters: command.payload.parameters,
        providerCapabilities: await recipeCapabilities(app),
        transactionId: `recipe-preview-${command.id}`
      });
      if (result.kind === "blocked") recipeBlocked(result.blockers);
      const warnings = [
        `Preview targets the first root graph (${target.title}) because recipe.preview does not carry a target graph ID.`,
        ...result.providers.filter((provider) => provider.mode === "substitution").map((provider) =>
          `${provider.requirementId} will use ${provider.capability.providerId}/${provider.capability.profileId} as a declared substitution.`)
      ];
      return commandResponse(command, { transaction: result.transaction, warnings });
    }
    case "recipe.instantiate": {
      const manifest = requireRecipe(command.payload.recipeId, command.payload.version);
      const snapshot = await store.read(({ graphs, revisions }) => ({ graphs: graphs.list(), head: revisions.head() }));
      const result = instantiateRecipe({
        manifest,
        graphs: snapshot.graphs,
        targetGraphId: command.payload.targetGraphId,
        baseDocumentRevisionId: snapshot.head.documentRevisionId,
        baseGraphRevisions: snapshot.head.graphRevisions,
        parameters: command.payload.parameters,
        providerCapabilities: await recipeCapabilities(app),
        transactionId: `recipe-${command.id}`
      });
      if (result.kind === "blocked") recipeBlocked(result.blockers);
      const revision = await app.applyGraphTransaction({ commandId: command.id, transaction: result.transaction });
      return commandResponse(command, revisionPayload(revision));
    }
    case "artifact.export": {
      return commandResponse(command, { records: await app.exportArtifacts({ commandId: command.id, ...command.payload }) });
    }
    case "artifact.dragExport":
      return commandResponse(command, await app.createDragExport(command.id, command.payload.artifactIds, command.payload.lifetimeHours));
    case "artifact.deleteDerivative":
      await commandOnce(app, command, "acknowledgement", (repositories) => {
        repositories.artifacts.deleteDerivative(command.payload.artifactId);
        return acknowledgement();
      }, [{ name: "artifact.changed", payload: { artifactId: command.payload.artifactId, change: "deleted" } }]);
      return commandResponse(command, acknowledgement());
    case "export.retry":
      return commandResponse(command, { records: await app.retryExport(command.id, command.payload.exportId) });
    case "export.cancel":
      await app.cancelExport(command.id, command.payload.exportId);
      return commandResponse(command, acknowledgement());
    case "recovery.inspect":
      return commandResponse(command, await app.inspectRecovery());
    case "recovery.dismiss":
      app.dismissRecovery(command.payload.reportId);
      return commandResponse(command, acknowledgement());
    case "liveOutput.enable": {
      const result = await app.enableLiveOutput(command.payload);
      return commandResponse(command, { operationId: result.operationId, enabled: true });
    }
    case "liveOutput.disable":
      await app.disableLiveOutput();
      return commandResponse(command, { enabled: false });
    case "liveOutput.rebuild":
      return commandResponse(command, { operationId: await app.rebuildLiveOutput() });
    case "liveOutput.reconcile":
      return commandResponse(command, { operationId: await app.reconcileLiveOutputMirror() });
    case "liveOutput.removeMirrorFiles":
      return commandResponse(command, { operationId: await app.removeLiveOutputFiles() });
    case "provider.probe":
      return commandResponse(command, { health: await providerHealth(app.boundaryProvider()) });
    case "provider.refresh":
      return commandResponse(command, { providers: [await providerHealth(app.boundaryProvider())] });
  }
}

export async function executeApplicationQuery(
  app: EtherApplication,
  query: ApplicationQuery
): Promise<QueryResponse> {
  const store = app.boundaryStore();
  if ("documentId" in query) assertDocument(query, store);

  switch (query.name) {
    case "document.summary": {
      const summary = await store.read(({ settings, graphs, artifacts }) => ({
        header: settings.getHeader(), graphCount: graphs.list().length, artifactCount: artifacts.list().length
      }));
      return queryResponse(query, { ...summary, mode: store.mode.kind });
    }
    case "document.dirtyState": {
      const head = await store.read(({ revisions }) => revisions.head());
      return queryResponse(query, { dirty: store.dirty, documentRevisionId: head.documentRevisionId });
    }
    case "graph.snapshot": {
      const snapshot = await store.read(({ graphs, revisions }) => ({
        graph: graphs.get(query.payload.graphId),
        head: revisions.head()
      }));
      if (snapshot.graph === undefined) throw new Error(`Unknown graph ${query.payload.graphId}.`);
      const graphRevisionId = snapshot.head.graphRevisions[query.payload.graphId];
      if (graphRevisionId === undefined) throw new Error(`Missing revision for graph ${query.payload.graphId}.`);
      return queryResponse(query, {
        graph: snapshot.graph,
        documentRevisionId: snapshot.head.documentRevisionId,
        graphRevisionId
      });
    }
    case "graph.catalog":
      return queryResponse(query, { graphs: await store.read(({ graphs }) => graphs.list().map((graph) => ({ id: graph.id, title: graph.title, kind: graph.kind }))) });
    case "graph.selectionDetails":
      return queryResponse(query, { nodes: await store.read(({ graphs }) => {
        const graph = graphs.get(query.payload.graphId);
        if (graph === undefined) throw new Error(`Unknown graph ${query.payload.graphId}.`);
        return graph.nodes.filter((node) => query.payload.nodeIds.includes(node.id));
      }), edges: await store.read(({ graphs }) => {
        const graph = graphs.get(query.payload.graphId);
        if (graph === undefined) throw new Error(`Unknown graph ${query.payload.graphId}.`);
        return graph.edges.filter((edge) => query.payload.edgeIds.includes(edge.id));
      }) });
    case "graph.validation": {
      const graphs = await store.read(({ graphs }) => graphs.list());
      const issues = validateFullGraphState(graphs).map((issue) => ({
        code: issue.code,
        message: issue.message,
        nodeId: issue.entityId ?? null,
        edgeId: issue.entityId ?? null
      }));
      return queryResponse(query, { valid: issues.length === 0, issues });
    }
    case "node.outputs": return queryResponse(query, { nodeId: query.payload.nodeId, outputs: await app.queryNodeOutputs(query.payload.nodeId) });
    case "node.compiledInputPreview": return queryResponse(query, await app.compiledInputPreview(query.payload.nodeId));
    case "reference.list":
      return queryResponse(query, { references: (await app.queryReferences()).filter((reference) => query.payload.state === undefined || reference.state === query.payload.state) });
    case "reference.detail": {
      const reference = await store.read(({ references }) => references.get(query.payload.referenceId));
      if (reference === undefined) throw new Error(`Unknown reference ${query.payload.referenceId}.`);
      return queryResponse(query, { reference });
    }
    case "output.detail": {
      const output = await store.read(({ outputs }) => outputs.getVersion(query.payload.outputVersionId));
      if (output === undefined) throw new Error(`Unknown output ${query.payload.outputVersionId}.`);
      return queryResponse(query, { output });
    }
    case "provider.capabilities": return queryResponse(query, { capabilities: await recipeCapabilities(app) });
    case "provider.health": return queryResponse(query, { providers: [await providerHealth(app.boundaryProvider())] });
    case "plan.summary": return queryResponse(query, { plan: await app.queryPlan(query.payload.planId) });
    case "job.summary": return queryResponse(query, { job: await app.queryJob(query.payload.jobId) });
    case "job.list":
      return queryResponse(query, { jobs: await store.read(({ execution }) => execution.listJobs()
        .filter((job) => query.payload.status === undefined || job.status === query.payload.status)
        .slice(0, query.payload.limit ?? 500)) });
    case "job.timeline":
      return queryResponse(query, { jobId: query.payload.jobId, entries: await store.read(({ execution }) => execution.listTimeline(query.payload.jobId).map((entry) => ({
        id: entry.id, occurredAt: entry.occurredAt, state: entry.state, workItemId: entry.workItemId, attemptId: entry.attemptId
      }))) });
    case "job.workItems": return queryResponse(query, { jobId: query.payload.jobId, workItems: await app.queryWorkItems(query.payload.jobId) });
    case "job.attempts": return queryResponse(query, { jobId: query.payload.jobId, attempts: await app.queryAttempts(query.payload.jobId) });
    case "review.checkpoints": return queryResponse(query, await store.read(({ execution }) => execution.searchReviewCheckpoints(query.payload)));
    case "artifact.search": {
      return queryResponse(query, await store.read(({ artifacts }) => artifacts.searchPage({
        ...query.payload,
        outputVersionIds: query.payload.outputVersionIds ?? []
      })));
    }
    case "artifact.detail": {
      const detail = await store.read(({ artifacts }) => artifacts.detail(query.payload.artifactId));
      if (detail === undefined) throw new Error(`Unknown artifact ${query.payload.artifactId}.`);
      return queryResponse(query, detail);
    }
    case "collection.list": return queryResponse(query, { collections: await store.read(({ collections }) => collections.list()) });
    case "collection.detail": return queryResponse(query, await store.read(({ collections }) => {
      const collection = collections.get(query.payload.collectionId);
      if (collection === undefined) throw new Error(`Unknown collection ${query.payload.collectionId}.`);
      return { collection, memberships: collections.memberships(collection.id) };
    }));
    case "collection.membership": return queryResponse(query, { memberships: await store.read(({ collections }) => collections.memberships(query.payload.collectionId)) });
    case "artifact.lineage": return queryResponse(query, { lineage: await store.read(({ artifacts }) => artifacts.detail(query.payload.artifactId)?.lineage ?? []) });
    case "export.records": return queryResponse(query, { records: await store.read(({ exports }) => exports.list(query.payload)) });
    case "liveOutput.status": return queryResponse(query, { settings: await app.liveOutputStatus() });
    case "liveOutput.entries": return queryResponse(query, { entries: await app.liveOutputEntries(query.payload) });
    case "liveOutput.operations": return queryResponse(query, { operations: await app.liveOutputOperations(query.payload) });
    case "recovery.status": return queryResponse(query, app.recoveryStatus());
    case "storage.status": {
      const [file, blobs] = await Promise.all([stat(store.path), store.read(({ blobs }) => blobs.list())]);
      return queryResponse(query, { documentBytes: file.size, blobBytes: blobs.reduce((total, blob) => total + blob.byteLength, 0), reclaimableBytes: 0 });
    }
    case "recipe.catalog": return queryResponse(query, { recipes: BUILTIN_RECIPES });
    case "recipe.setupSchema": {
      const manifest = requireRecipe(query.payload.recipeId, query.payload.version);
      return queryResponse(query, {
        recipeId: manifest.id,
        version: manifest.version,
        parameters: manifest.parameters,
        capabilities: inspectRecipeProviderSetup(manifest, await recipeCapabilities(app))
      });
    }
  }
}
