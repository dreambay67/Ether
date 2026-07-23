import { randomUUID } from "node:crypto";
import path from "node:path";

export type PathGrantPurpose = "live-output" | "export" | "reference";

export interface ResolvedPathGrant {
  displayName?: string;
  kind: "directory" | "file";
  mediaType?: string;
  path: string;
}

export interface PathGrantResolver {
  resolve(input: {
    documentId: string;
    pathGrantId: string;
    purpose: PathGrantPurpose;
  }): Promise<ResolvedPathGrant> | ResolvedPathGrant;
}

export interface ApplicationPermit {
  expiresAt: string | null;
  id: string;
  permission: "edit" | "path" | "run";
}

export interface ApplicationPermitInspection extends ApplicationPermit {
  contentHash?: string;
  planId?: string;
  state: "active" | "start-consumed" | "expired" | "revoked";
}

interface StoredPermit extends ApplicationPermit {
  commandId: string;
  consumedByCommandId?: string;
  contentHash?: string;
  pathGrantId?: string;
  planId?: string;
  purpose?: PathGrantPurpose;
  resolution?: ResolvedPathGrant;
  revoked: boolean;
}

export class ApplicationPermitStore {
  private readonly permits = new Map<string, StoredPermit>();
  private readonly permitByCommand = new Map<string, string>();

  grantEdit(commandId: string, expiresAt: string | null): ApplicationPermit {
    return this.grant(commandId, { expiresAt, permission: "edit" });
  }

  grantPath(
    commandId: string,
    pathGrantId: string,
    purpose: PathGrantPurpose,
    resolution: ResolvedPathGrant
  ): ApplicationPermit {
    const expectedKind = purpose === "reference" ? "file" : "directory";
    if (resolution.kind !== expectedKind) {
      throw permitError("PATH_GRANT_KIND_MISMATCH", `${purpose} grants require a ${expectedKind}.`);
    }
    if (!path.isAbsolute(resolution.path) || resolution.path.includes("\0")) {
      throw permitError("PATH_GRANT_INVALID", "Path grants must resolve to an absolute local path.");
    }
    return this.grant(commandId, {
      expiresAt: null,
      pathGrantId,
      permission: "path",
      purpose,
      resolution: { ...resolution, path: path.resolve(resolution.path) }
    });
  }

  registerRun(
    commandId: string,
    permitId: string,
    planId: string,
    contentHash: string
  ): ApplicationPermit {
    const duplicate = this.byCommand(commandId);
    if (duplicate !== undefined) return publicPermit(duplicate);
    const permit: StoredPermit = {
      commandId,
      contentHash,
      expiresAt: null,
      id: permitId,
      permission: "run",
      planId,
      revoked: false,
      consumedByCommandId: undefined
    };
    this.permits.set(permit.id, permit);
    this.permitByCommand.set(commandId, permit.id);
    return publicPermit(permit);
  }

  requireEdit(permitId: string): void {
    const permit = this.requireActive(permitId);
    if (permit.permission !== "edit") {
      throw permitError("EDIT_PERMISSION_REQUIRED", "An active Edit Permit is required.");
    }
  }

  requireRun(permitId: string, planId: string, contentHash: string, commandId?: string): void {
    const permit = this.requireActive(permitId);
    if (permit.permission !== "run" || permit.planId !== planId || permit.contentHash !== contentHash) {
      throw permitError("RUN_PERMIT_MISMATCH", "The run permit does not authorize this exact immutable plan.");
    }
    if (permit.consumedByCommandId !== undefined && permit.consumedByCommandId !== commandId) {
      throw permitError("RUN_PERMIT_INVALID", "The run permit has already been consumed.");
    }
  }

  requireRunControl(permitId: string, planId: string, contentHash: string): void {
    const permit = this.requireActive(permitId);
    if (permit.permission !== "run" || permit.planId !== planId || permit.contentHash !== contentHash) {
      throw permitError("RUN_PERMIT_MISMATCH", "The run permit does not authorize this exact immutable plan.");
    }
  }

  consumeRun(permitId: string, commandId: string): void {
    const permit = this.permits.get(permitId);
    if (permit === undefined || permit.permission !== "run") {
      throw permitError("RUN_PERMIT_INVALID", "The run permit is missing or invalid.");
    }
    if (permit.consumedByCommandId !== undefined && permit.consumedByCommandId !== commandId) {
      throw permitError("RUN_PERMIT_INVALID", "The run permit has already been consumed.");
    }
    permit.consumedByCommandId = commandId;
  }

  releaseRun(permitId: string, commandId: string): void {
    const permit = this.permits.get(permitId);
    if (permit?.permission === "run" && permit.consumedByCommandId === commandId) {
      permit.consumedByCommandId = undefined;
    }
  }

  requirePath(pathGrantId: string, purpose: PathGrantPurpose): ResolvedPathGrant {
    const permit = [...this.permits.values()].find((candidate) =>
      !candidate.revoked && candidate.permission === "path" &&
      candidate.pathGrantId === pathGrantId && candidate.purpose === purpose
    );
    if (permit?.resolution === undefined || expired(permit)) {
      throw permitError("PATH_PERMISSION_REQUIRED", `Grant ${pathGrantId} is not authorized for ${purpose}.`);
    }
    return permit.resolution;
  }

  isActivePath(pathGrantId: string, purpose: PathGrantPurpose): boolean {
    try {
      this.requirePath(pathGrantId, purpose);
      return true;
    } catch {
      return false;
    }
  }

  authorizesReference(grantId: string, documentPath: string): boolean {
    try {
      return path.resolve(this.requirePath(grantId, "reference").path) === path.resolve(documentPath);
    } catch {
      return false;
    }
  }

  revoke(permitId: string): ApplicationPermit {
    const permit = this.permits.get(permitId);
    if (permit === undefined) throw permitError("PERMIT_NOT_FOUND", `Unknown permit ${permitId}.`);
    permit.revoked = true;
    return publicPermit(permit);
  }

  isActive(permitId: string): boolean {
    const permit = this.permits.get(permitId);
    return permit !== undefined && !permit.revoked && !expired(permit) && permit.consumedByCommandId === undefined;
  }

  inspect(): ApplicationPermitInspection[] {
    return [...this.permits.values()].map((permit) => ({
      ...publicPermit(permit),
      state: permit.revoked
        ? "revoked"
        : expired(permit)
          ? "expired"
          : permit.consumedByCommandId === undefined ? "active" : "start-consumed",
      ...(permit.planId === undefined ? {} : { planId: permit.planId }),
      ...(permit.contentHash === undefined ? {} : { contentHash: permit.contentHash })
    }));
  }

  private grant(
    commandId: string,
    input: Omit<StoredPermit, "commandId" | "id" | "revoked">
  ): ApplicationPermit {
    const duplicate = this.byCommand(commandId);
    if (duplicate !== undefined) return publicPermit(duplicate);
    const permit: StoredPermit = {
      ...input,
      commandId,
      id: `permit-${randomUUID()}`,
      revoked: false
    };
    this.permits.set(permit.id, permit);
    this.permitByCommand.set(commandId, permit.id);
    return publicPermit(permit);
  }

  private byCommand(commandId: string): StoredPermit | undefined {
    const id = this.permitByCommand.get(commandId);
    return id === undefined ? undefined : this.permits.get(id);
  }

  private requireActive(permitId: string): StoredPermit {
    const permit = this.permits.get(permitId);
    if (permit === undefined || permit.revoked) {
      throw permitError("PERMIT_REVOKED", "The requested permit is absent or revoked.");
    }
    if (expired(permit)) throw permitError("PERMIT_EXPIRED", "The requested permit has expired.");
    return permit;
  }
}

function expired(permit: StoredPermit): boolean {
  return permit.expiresAt !== null && Date.parse(permit.expiresAt) <= Date.now();
}

function publicPermit(permit: StoredPermit): ApplicationPermit {
  return { expiresAt: permit.expiresAt, id: permit.id, permission: permit.permission };
}

function permitError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
