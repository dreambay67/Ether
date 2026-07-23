import { AlertTriangle, Check, Clock3, LoaderCircle } from "lucide-react";

export type NodeRuntimeStatus = "queued" | "running" | "done" | "attention" | null;

export function NodeStatusLayer({ status }: { status: NodeRuntimeStatus }) {
  if (status === null) return null;
  const icon = status === "queued" ? <Clock3 size={12} aria-hidden="true" /> : status === "running" ? <LoaderCircle size={12} aria-hidden="true" /> : status === "done" ? <Check size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />;
  const label = status === "attention" ? "Needs attention" : status[0]!.toUpperCase() + status.slice(1);
  return <span className={`node-status-layer node-status-${status}`} data-testid={`node-status-${status}`} aria-label={label}>{icon}{label}</span>;
}
