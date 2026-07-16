import { useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

export function ContextHelp({
  id,
  label,
  children
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = `context-help-tooltip-${id}`;

  return (
    <span className="context-help">
      <button
        type="button"
        className="context-help-button"
        aria-label={`${label} help`}
        aria-describedby={tooltipId}
        aria-expanded={isOpen}
        data-testid={`context-help-control-${id}`}
        onBlur={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
            event.currentTarget.blur();
          }
        }}
        onPointerEnter={() => setIsOpen(true)}
        onPointerLeave={() => setIsOpen(false)}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="context-help-tooltip"
        aria-hidden={!isOpen}
        data-open={isOpen ? "true" : "false"}
        data-testid={tooltipId}
      >
        {children}
      </span>
    </span>
  );
}
