import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

function normalizeCanonicalPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function assertAbsoluteLocalPath(filePath: string): void {
  if (filePath.length === 0 || filePath.includes("\0") || !path.isAbsolute(filePath)) {
    throw Object.assign(new Error("Path grants require an absolute local path."), { code: "PATH_GRANT_INVALID" });
  }
}

/** Resolve every existing grant target so a later symlink swap cannot broaden it. */
export function canonicalGrantPath(filePath: string): string {
  assertAbsoluteLocalPath(filePath);
  return normalizeCanonicalPath(realpathSync.native(filePath));
}

/** Canonicalize a possibly-not-yet-created Save As target through its real parent. */
export function canonicalGrantDestinationPath(filePath: string): string {
  assertAbsoluteLocalPath(filePath);
  try {
    return canonicalGrantPath(filePath);
  } catch (error) {
    if ((error as { code?: unknown }).code === "PATH_GRANT_INVALID") throw error;
    const parent = realpathSync.native(path.dirname(path.resolve(filePath)));
    return normalizeCanonicalPath(path.join(parent, path.basename(filePath)));
  }
}

export function tryCanonicalGrantPath(filePath: string): string | null {
  try {
    return canonicalGrantPath(filePath);
  } catch {
    return null;
  }
}

export interface PathGrantTargetIdentity {
  birthtimeNs: string;
  dev: string;
  ino: string;
  kind: "directory" | "file";
}

function identityAt(canonicalPath: string): PathGrantTargetIdentity {
  const stat = lstatSync(canonicalPath, { bigint: true });
  if (!stat.isFile() && !stat.isDirectory()) {
    throw Object.assign(new Error("Path grants require a regular file or directory."), {
      code: "PATH_GRANT_INVALID"
    });
  }
  return {
    birthtimeNs: stat.birthtimeNs.toString(),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    kind: stat.isDirectory() ? "directory" : "file"
  };
}

function sameIdentity(left: PathGrantTargetIdentity, right: PathGrantTargetIdentity): boolean {
  return left.birthtimeNs === right.birthtimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.kind === right.kind;
}

/**
 * Capture a canonical target and stable filesystem identity as one grant
 * operation. Rechecking both sides closes the realpath-to-lstat swap window.
 */
export function capturePathGrantTarget(filePath: string): {
  identity: PathGrantTargetIdentity;
  path: string;
} {
  const canonicalPath = canonicalGrantPath(filePath);
  const before = identityAt(canonicalPath);
  const confirmedPath = canonicalGrantPath(filePath);
  const after = identityAt(confirmedPath);
  if (confirmedPath !== canonicalPath || !sameIdentity(before, after)) {
    throw Object.assign(new Error("The selected path changed while Ether was granting access."), {
      code: "PATH_GRANT_CHANGED"
    });
  }
  return { identity: after, path: confirmedPath };
}

export function pathGrantTargetIsCurrent(
  canonicalPath: string,
  expected: PathGrantTargetIdentity
): boolean {
  try {
    return canonicalGrantPath(canonicalPath) === canonicalPath &&
      sameIdentity(identityAt(canonicalPath), expected);
  } catch {
    return false;
  }
}

/** A delimiter-safe in-memory key for opaque IDs that are never filesystem paths. */
export function pathGrantKey(grantId: string, documentId: string): string {
  if (
    grantId.length === 0 ||
    documentId.length === 0 ||
    grantId.includes("\0") ||
    documentId.includes("\0")
  ) {
    throw Object.assign(new Error("Path grant identifiers are invalid."), { code: "PATH_GRANT_INVALID" });
  }
  return `${grantId}\0${documentId}`;
}
