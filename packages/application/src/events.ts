import type { ApplicationEvent } from "@ether/schema";

import type { ApplicationEventBus } from "./events/eventBus.js";

/** Subscribe through the outbox-backed bus without exposing renderer state. */
export function subscribeToApplicationEvents(
  bus: ApplicationEventBus,
  listener: (event: ApplicationEvent) => void
): () => void {
  return bus.subscribe(listener);
}
