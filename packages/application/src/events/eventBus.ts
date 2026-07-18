import type { ApplicationEvent } from "@ether/schema";

export class ApplicationEventBus {
  private readonly listeners = new Set<(event: ApplicationEvent) => void>();

  subscribe(listener: (event: ApplicationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ApplicationEvent): void {
    for (const listener of this.listeners) listener(structuredClone(event));
  }
}
