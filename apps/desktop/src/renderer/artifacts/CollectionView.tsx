import { useCallback, useEffect, useState } from "react";
import { FolderHeart, Plus, Star } from "lucide-react";
import type { Collection, CollectionMembership } from "@ether/schema";

export function CollectionView({ documentId, selectedArtifactIds, onStatus }: { documentId: string; selectedArtifactIds: string[]; onStatus(message: string): void }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberships, setMemberships] = useState<Record<string, CollectionMembership[]>>({});
  const [title, setTitle] = useState("");

  const refresh = useCallback(async () => {
    const response = await window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "collection.list", payload: {} });
    if (response.name !== "collection.list") throw new Error("Ether returned an unexpected collection response.");
    setCollections(response.payload.collections);
    const details = await Promise.all(response.payload.collections.map(async (collection) => {
      const membership = await window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "collection.membership", payload: { collectionId: collection.id } });
      if (membership.name !== "collection.membership") throw new Error("Ether returned an unexpected membership response.");
      return [collection.id, membership.payload.memberships] as const;
    }));
    setMemberships(Object.fromEntries(details));
  }, [documentId]);

  useEffect(() => { void refresh().catch((cause) => onStatus(cause instanceof Error ? cause.message : "Collections could not be loaded.")); }, [onStatus, refresh]);
  useEffect(() => window.ether.application.onEvent((event) => {
    if ("documentId" in event && event.documentId === documentId && event.name === "collection.changed") void refresh();
  }), [documentId, refresh]);

  const command = async (name: "collection.create" | "collection.addMembers" | "collection.removeMembers" | "collection.setPrimary", payload: Record<string, unknown>, success: string) => {
    try {
      await window.ether.application.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name, payload } as Parameters<typeof window.ether.application.command>[0]);
      onStatus(success);
      await refresh();
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "Collection update needs attention.");
    }
  };

  return <section className="collection-view" aria-label="Collections">
    <header><div><FolderHeart size={16} /><span>Many-to-many routing</span><h3>Collections</h3></div><form onSubmit={(event) => { event.preventDefault(); if (title.trim()) void command("collection.create", { title: title.trim(), description: "Created in Artifact Observatory" }, "Collection created.").then(() => setTitle("")); }}><input aria-label="New collection title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="New collection" /><button type="submit" disabled={!title.trim()}><Plus size={14} />Create</button></form></header>
    <p>Membership is internal and non-destructive. One artifact may belong to any number of collections.</p>
    <div className="collection-cards">{collections.length === 0 ? <div className="collection-empty" role="status"><strong>No collections yet</strong><span>Create a collection above, then add selected artifacts to it.</span></div> : collections.map((collection) => {
      const members = memberships[collection.id] ?? [];
      const selectedInside = selectedArtifactIds.filter((id) => members.some((member) => member.artifactId === id));
      return <article key={collection.id} className={collection.primary ? "is-primary" : ""}>
        <header><div>{collection.primary ? <Star size={14} /> : <FolderHeart size={14} />}<strong>{collection.title}</strong></div><span>{members.length} items</span></header>
        <p>{collection.description || "No description"}</p>
        <div className="collection-actions"><button type="button" disabled={selectedArtifactIds.length === 0} onClick={() => void command("collection.addMembers", { collectionId: collection.id, members: selectedArtifactIds.map((artifactId, position) => ({ artifactId, role: "general", position })) }, `Added selection to ${collection.title}.`)}>Add selection</button><button type="button" disabled={selectedInside.length === 0} onClick={() => void command("collection.removeMembers", { collectionId: collection.id, artifactIds: selectedInside }, `Removed selection from ${collection.title}.`)}>Remove selection</button><button type="button" disabled={collection.primary} onClick={() => void command("collection.setPrimary", { collectionId: collection.id }, `${collection.title} is now primary.`)}>Make primary</button></div>
        <ul>{members.slice(0, 8).map((member) => <li key={member.artifactId}><code>{member.artifactId}</code><span>{member.role}</span></li>)}</ul>
      </article>;
    })}</div>
  </section>;
}
