import { Play, Sparkles } from "lucide-react";
import type { EtherNode } from "@ether/schema";
import { getNodeDefinition } from "@ether/graph-kernel";
import { documentCommand } from "./applicationRequests";
import { Help } from "./NodeSetup";
import { markPerformance, measurePerformance } from "../../performance/marks";

type Bridge = { command(command: unknown): Promise<{ payload?: { plan?: { id: string; estimatedCalls: number } } }> };
const appBridge = () => (window.ether as unknown as { application?: Bridge }).application;

export function RunControls({ node, graphId, documentId, disabled, report }: { node: EtherNode; graphId: string; documentId: string; disabled: boolean; report(message: string): void }) {
  const executor = getNodeDefinition(node.definitionId).executor;
  const action = ({
    "codex-llm": ["Generate Output", "Build the real Codex worker plan for this node."],
    "image-provider": ["Generate Image", "Build the real provider-backed image plan for this node."],
    "edit-provider": ["Generate Edit", "Build the real provider-backed edit plan for this node."],
    "codex-evaluation": ["Evaluate Outputs", "Build the real Codex evaluation plan for this node."],
    mask: ["Run Mask", "Build the deterministic mask plan for this node."],
    transform: ["Run Transform", "Build the deterministic transform plan for this node."],
    deterministic: ["Run Node", "Build the deterministic execution plan for this node."],
    "deterministic-filter": ["Run Filter", "Build the deterministic routing plan for this node."],
    batch: ["Build Batch", "Build the batch expansion plan for this node."],
    join: ["Run Join", "Build the deterministic join plan for this node."],
    collection: ["Update Collection", "Build the collection membership plan for this node."],
    export: ["Export Outputs", "Build the durable export plan for this node."]
  } as Record<string, [string, string] | undefined>)[executor];
  if (!action) return null;
  const generate = async () => {
    try {
      const bridge = appBridge();
      if (!bridge) throw new Error("The typed application bridge is unavailable.");
      markPerformance("plan-compilation:start");
      const response = await bridge.command(documentCommand("run.preview", documentId, { graphId, scope: { kind: "node", nodeId: node.id } }));
      markPerformance("plan-compilation:complete");
      measurePerformance("plan-compilation", "plan-compilation:start", "plan-compilation:complete");
      const plan = response.payload?.plan;
      report(plan ? `Output plan is ready: ${plan.estimatedCalls} provider call${plan.estimatedCalls === 1 ? "" : "s"}.` : "The output plan is ready for Run workspace confirmation.");
    } catch (error) { report(error instanceof Error ? error.message : "Output planning needs attention."); }
  };
  return <section className="inspector-run-controls"><button type="button" className="inspector-primary-action" disabled={disabled} onClick={() => void generate()} title={action[1]}><Sparkles size={15} aria-hidden="true" />{action[0]}</button><button type="button" disabled={disabled} onClick={() => void generate()} title="Inspect the actual execution plan without starting work."><Play size={14} aria-hidden="true" />Preview plan</button><Help label={action[0]} text="This builds a real application execution plan. Run confirmation remains in the Run workspace." /></section>;
}
