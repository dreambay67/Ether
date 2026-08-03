import {
  adapterCandidates,
  canonicalConnectionIdentity,
  getNodeDefinition,
  validateConnection
} from "@ether/graph-kernel";
import {
  connectionRoles,
  type ConnectionDecision,
  type ConnectionRole,
  type EdgeAdapter,
  type EtherEdge,
  type PayloadChannel
} from "@ether/schema";
import { channelLabel } from "../ports/channelRegistry";
import { Help, InspectorSection } from "./NodeSetup";
import { roleLabels } from "./inspectorConfig";
import type { InspectorEdgeContext } from "./types";

function endpointName(context: InspectorEdgeContext, endpoint: EtherEdge["from"]): string {
  if (endpoint.kind === "node") return context.graph.nodes.find((node) => node.id === endpoint.nodeId)?.title ?? endpoint.nodeId;
  return context.graph.modules.find((module) => module.id === endpoint.moduleId)?.title ?? `Module ${endpoint.portId}`;
}

function endpointChannels(context: InspectorEdgeContext, endpoint: EtherEdge["from"], direction: "input" | "output"): readonly PayloadChannel[] {
  if (endpoint.kind === "module") return [endpoint.channel];
  const node = context.graph.nodes.find((candidate) => candidate.id === endpoint.nodeId);
  if (node === undefined) return [endpoint.channel];
  const library = getNodeDefinition(node.definitionId).library;
  return direction === "input" ? library.inputChannels : library.outputChannels;
}

function decisionFor(context: InspectorEdgeContext, candidate: EtherEdge): ConnectionDecision | null {
  const from = candidate.from; const to = candidate.to;
  if (from.kind !== "node" || to.kind !== "node") return null;
  const source = context.graph.nodes.find((node) => node.id === from.nodeId);
  const target = context.graph.nodes.find((node) => node.id === to.nodeId);
  if (source === undefined || target === undefined) return null;
  return validateConnection({
    sourceDefinitionId: source.definitionId,
    sourceChannel: candidate.from.channel,
    targetDefinitionId: target.definitionId,
    targetChannel: candidate.to.channel,
    role: candidate.role,
    adapter: candidate.adapter,
    candidate,
    existingEdges: context.graph.edges,
    capabilities: [],
    topology: { graphs: [context.graph] }
  });
}

export function EdgeInspector({ context }: { context: InspectorEdgeContext }) {
  const { edge, graph, apply, document, report } = context;
  const commit = (candidate: EtherEdge, title: string) => {
    const duplicate = graph.edges.find((item) => item.id !== candidate.id && canonicalConnectionIdentity(item) === canonicalConnectionIdentity(candidate));
    if (duplicate !== undefined) {
      report("DUPLICATE_LANE: An exact connection lane already exists. Change its role or output selection to keep both lanes.");
      return;
    }
    const decision = decisionFor(context, candidate);
    if (decision !== null && !decision.allowed) {
      report(`${decision.code}: ${decision.message}`);
      return;
    }
    void apply([{ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: candidate }], title);
  };
  const update = (next: Partial<typeof edge>, title: string) => commit({ ...edge, ...next }, title);
  const source = endpointName(context, edge.from);
  const target = endpointName(context, edge.to);
  const sourceChannels = endpointChannels(context, edge.from, "output");
  const targetChannels = endpointChannels(context, edge.to, "input");
  const decision = decisionFor(context, edge);
  const adapters = adapterCandidates(edge.from.channel, edge.to.channel);
  const resolvedAdapter = decision?.allowed ? decision.adapter : null;
  const consequence = decision?.allowed ? decision.consequences[0] : undefined;
  const adapterValue = edge.adapter.kind === "auto" ? "auto" : edge.adapter.adapterId;
  const setAdapter = (value: string) => update({ adapter: value === "auto" ? { kind: "auto" } : { kind: "explicit", adapterId: value } as EdgeAdapter }, "Change connection adapter");
  const setEndpointChannel = (endpoint: "source" | "target", channel: PayloadChannel) => update(endpoint === "source" ? { from: { ...edge.from, channel } } : { to: { ...edge.to, channel } }, `Change ${endpoint} channel`);

  return <div className="ether-inspector" data-testid="edge-inspector">
    <InspectorSection title="Connection" help="A connection moves one of Ether's six channels and gives the receiver one explicit role.">
      <div className="inspector-route"><strong>{source}</strong><span>{channelLabel(edge.from.channel)} to {channelLabel(edge.to.channel)}</span><strong>{target}</strong></div>
      <div className={`inspector-connection-state ${decision !== null && !decision.allowed ? "is-blocked" : "is-ready"}`} role="status">
        <strong>{decision === null ? "Module route" : decision.allowed ? resolvedAdapter === null ? "Direct channel" : `Adapter · ${resolvedAdapter.adapterId}` : decision.code}</strong>
        <span>{decision === null ? "Module port validation is owned by the module interface." : decision.allowed ? consequence ? `${consequence.executorInputField} · ${consequence.assemblyStrategy}` : "The receiver accepts this lane." : decision.message}</span>
      </div>
      <label>Source channel <Help label="Source channel" text="The output channel is constrained by the source node's canonical contract." /><select aria-label="Source channel" disabled={document.mode !== "writable"} value={edge.from.channel} onChange={(event) => setEndpointChannel("source", event.target.value as PayloadChannel)}>{sourceChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</select></label>
      <label>Target channel <Help label="Target channel" text="The input channel is constrained by the receiver's canonical contract and available local adapters." /><select aria-label="Target channel" disabled={document.mode !== "writable"} value={edge.to.channel} onChange={(event) => setEndpointChannel("target", event.target.value as PayloadChannel)}>{targetChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</select></label>
      <label>Role <Help label="Connection role" text="The role is visible on the lane and determines how the receiver interprets this payload." /><select aria-label="Connection role" disabled={document.mode !== "writable"} value={edge.role} onChange={(event) => update({ role: event.target.value as ConnectionRole }, "Change connection role")}>{connectionRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
      <label>Output selection <Help label="Output selection" text="An edge can consume the latest approved output, latest output, every variant, or one explicitly pinned version." /><select aria-label="Output selection" disabled={document.mode !== "writable" || edge.selector.kind === "pinned"} value={edge.selector.kind} onChange={(event) => { const kind = event.target.value as "latest-approved" | "latest" | "all"; update({ selector: { kind } }, "Change output selection"); }}><option value="latest-approved">Latest approved</option><option value="latest">Latest output</option><option value="all">All variants</option>{edge.selector.kind === "pinned" ? <option value="pinned">Pinned output version</option> : null}</select></label>
    </InspectorSection>
    <InspectorSection title="Effect" help="Ether names the exact receiver field and assembly behavior before a lane can participate in a run.">
      {consequence ? <dl className="inspector-consequence"><div><dt>Receiver field</dt><dd>{consequence.executorInputField}</dd></div><div><dt>Assembly</dt><dd>{consequence.assemblyStrategy}</dd></div><div><dt>Preservation</dt><dd>{consequence.preservationRule}</dd></div></dl> : <p className="inspector-unavailable">{decision !== null && !decision.allowed ? decision.message : "The module interface resolves this consequence inside its child graph."}</p>}
    </InspectorSection>
    <InspectorSection advanced title="Connection diagnostics" help="Technical adapter, lane, and capability details stay collapsed until they are needed.">
      <label>Adapter <Help label="Connection adapter" text="Automatic chooses the first currently available declared adapter. Explicit choices remain visible but disabled when their required capability is unavailable." /><select aria-label="Connection adapter" disabled={document.mode !== "writable" || edge.from.channel === edge.to.channel} value={adapterValue} onChange={(event) => setAdapter(event.target.value)}><option value="auto">Automatic</option>{adapters.map((adapter) => <option key={adapter.id} value={adapter.id} disabled={adapter.requiredCapability !== null}>{adapter.id}{adapter.requiredCapability ? ` · needs ${adapter.requiredCapability}` : " · local"}</option>)}</select></label>
      <p>Resolved: {resolvedAdapter?.adapterId ?? (edge.from.channel === edge.to.channel ? "direct" : "unavailable")}</p>
      <p>Capability: {resolvedAdapter?.requiredCapability ?? "none"}</p>
      <p>Lane order: {edge.order + 1}</p>
      <label className="inspector-checkbox"><input type="checkbox" disabled={document.mode !== "writable"} checked={edge.enabled} onChange={(event) => update({ enabled: event.target.checked }, event.target.checked ? "Enable connection" : "Disable connection")} />Enabled</label>
    </InspectorSection>
  </div>;
}
