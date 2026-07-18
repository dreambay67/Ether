import type { ApplicationEvent } from "@ether/schema";

export class ApplicationEventBus {
  private readonly listeners = new Set<(event: ApplicationEvent) => void>();

  subscribe(listener: (event: ApplicationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ApplicationEvent): boolean {
    let delivered = true;
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        delivered = false;
      }
    }
    return delivered;
  }
}
