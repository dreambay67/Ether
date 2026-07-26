import type { ProviderBinding } from "@ether/schema";

import {
  providerConcurrencyGroup,
  providerParallelismLimit,
  SAFE_GLOBAL_PARALLELISM
} from "../plan/providerConcurrency.js";

type ConcurrencyWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abort: () => void;
};

class ConcurrencyGate {
  private active = 0;
  private readonly waiters: ConcurrencyWaiter[] = [];

  constructor(private limit: number) {}

  tighten(limit: number): void {
    this.limit = Math.min(this.limit, Math.max(1, Math.trunc(limit)));
    this.drain();
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(cancellationError());
    return new Promise<() => void>((resolve, reject) => {
      const waiter: ConcurrencyWaiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(cancellationError());
        }
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(cancellationError());
        continue;
      }
      this.active += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.drain();
      });
    }
  }
}

export class ExecutionConcurrencyDomains {
  private readonly globalGate = new ConcurrencyGate(SAFE_GLOBAL_PARALLELISM);
  private readonly providerGates = new Map<string, ConcurrencyGate>();

  async acquire(
    binding: ProviderBinding | null,
    signal: AbortSignal
  ): Promise<() => void> {
    let releaseProvider: (() => void) | undefined;
    let releaseGlobal: (() => void) | undefined;
    try {
      if (binding !== null) {
        const group = providerConcurrencyGroup(binding.providerId);
        const limit = providerParallelismLimit(binding);
        let gate = this.providerGates.get(group);
        if (gate === undefined) {
          gate = new ConcurrencyGate(limit);
          this.providerGates.set(group, gate);
        } else {
          gate.tighten(limit);
        }
        // A saturated provider must not occupy global capacity while it waits.
        releaseProvider = await gate.acquire(signal);
      }
      releaseGlobal = await this.globalGate.acquire(signal);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseGlobal?.();
        releaseProvider?.();
      };
    } catch (error) {
      releaseGlobal?.();
      releaseProvider?.();
      throw error;
    }
  }
}

function cancellationError(): Error {
  return new DOMException("Scheduler capacity wait was cancelled.", "AbortError");
}
