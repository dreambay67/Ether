import type { CodexAppServerClient, ThreadStartOptions } from "./client.js";

export type CodexClientGeneration = {
  client: CodexAppServerClient;
  generation: number;
};

export type CodexSessionIdentity = {
  documentId: string;
  memoryScopeKey: string | null;
};

type Session = {
  documentId: string;
  key: string;
  threadId: string;
  generation: number;
};

export class CodexAppServerSessionPool {
  private readonly sessions = new Map<string, Session>();
  private readonly tails = new Map<string, Promise<void>>();
  private closed = false;
  private generation: number | null = null;

  constructor(private readonly getClientGeneration: () => CodexClientGeneration) {}

  get size() {
    return this.sessions.size;
  }

  keys() {
    return [...this.sessions.values()].map((session) => session.key).sort();
  }

  async withThread<T>(
    identity: CodexSessionIdentity,
    threadOptions: ThreadStartOptions,
    operation: (threadId: string) => Promise<T> | T
  ): Promise<T> {
    if (this.closed) throw new Error("Codex App Server session pool is closed.");
    const current = this.getClientGeneration();
    this.observeGeneration(current.generation);
    if (identity.memoryScopeKey === null) {
      const started = await current.client.startThread(threadOptions);
      return operation(started.threadId);
    }
    const serializationKey = identity.memoryScopeKey;
    const prior = this.tails.get(serializationKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.catch(() => undefined).then(() => gate);
    this.tails.set(serializationKey, tail);
    await prior.catch(() => undefined);
    try {
      if (this.closed) throw new Error("Codex App Server session pool is closed.");
      const refreshed = this.getClientGeneration();
      this.observeGeneration(refreshed.generation);
      let session = this.sessions.get(serializationKey);
      if (!session || session.generation !== refreshed.generation) {
        const started = await refreshed.client.startThread(threadOptions);
        session = {
          documentId: identity.documentId,
          key: serializationKey,
          threadId: started.threadId,
          generation: refreshed.generation
        };
        this.sessions.set(serializationKey, session);
      }
      return await operation(session.threadId);
    } finally {
      release();
      if (this.tails.get(serializationKey) === tail) this.tails.delete(serializationKey);
    }
  }

  invalidateGeneration(generation: number) {
    if (this.generation === generation) return;
    this.generation = generation;
    this.sessions.clear();
  }

  clearDocument(documentId: string) {
    for (const [key, session] of this.sessions) {
      if (session.documentId === documentId) this.sessions.delete(key);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.sessions.clear();
    await Promise.allSettled(this.tails.values());
    this.tails.clear();
  }

  private observeGeneration(generation: number) {
    if (this.generation === null) {
      this.generation = generation;
      return;
    }
    if (this.generation !== generation) this.invalidateGeneration(generation);
  }
}
