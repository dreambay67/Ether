import { Handle, Position } from "@xyflow/react";
import type { ContractPort } from "@ether/engine";

type TypedHandleProps = {
  port: ContractPort;
  index: number;
  total: number;
};

export function TypedHandle({ port, index, total }: TypedHandleProps) {
  const isInput = port.direction === "input";
  const top = `${((index + 1) / (total + 1)) * 100}%`;
  const requiredLabel = port.required ? "required" : "optional";
  const title = `${port.label} ${isInput ? "input" : "output"} (${requiredLabel}): ${port.description}`;

  return (
    <span
      className={`typed-port typed-port-${port.direction}${port.required ? " is-required" : " is-optional"}`}
      data-testid={`typed-port-${port.direction}-${port.id}`}
      title={title}
      aria-label={title}
      style={{ top }}
    >
      <Handle
        id={port.id}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        className="typed-handle-dot"
        style={{ top: "50%" }}
      />
      <span className="typed-port-label">{port.label}</span>
      <span className="typed-port-state">{requiredLabel}</span>
    </span>
  );
}
