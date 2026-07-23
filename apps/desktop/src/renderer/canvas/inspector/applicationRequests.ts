function identity() {
  return { id: crypto.randomUUID(), correlationId: crypto.randomUUID() };
}

export function documentQuery(name: string, documentId: string, payload: unknown) {
  return { kind: "query" as const, ...identity(), name, documentId, payload };
}

export function globalQuery(name: string, payload: unknown) {
  return { kind: "query" as const, ...identity(), name, payload };
}

export function documentCommand(name: string, documentId: string, payload: unknown) {
  return { kind: "command" as const, ...identity(), name, documentId, payload };
}
