import { constants, type DatabaseSync } from "node:sqlite";

type HardenableDatabase = DatabaseSync & {
  enableDefensive?: (active: boolean) => void;
  setAuthorizer?: (
    callback: ((
      actionCode: number,
      arg1: string | null,
      arg2: string | null,
      databaseName: string | null,
      triggerOrView: string | null
    ) => number) | null
  ) => void;
};

export const ETHER_SQLITE_SECURITY_UNAVAILABLE = "SQLITE_SECURITY_UNAVAILABLE";

export interface EtherSqliteSecurityCapabilities {
  defensiveMode: boolean;
  statementAuthorizer: boolean;
}

export function inspectEtherSqliteSecurityCapabilities(
  database: DatabaseSync
): EtherSqliteSecurityCapabilities {
  const hardenable = database as HardenableDatabase;
  return {
    defensiveMode: typeof hardenable.enableDefensive === "function",
    statementAuthorizer: typeof hardenable.setAuthorizer === "function"
  };
}

function requireEtherSqliteSecurityCapabilities(database: DatabaseSync): HardenableDatabase {
  const capabilities = inspectEtherSqliteSecurityCapabilities(database);
  if (!capabilities.defensiveMode || !capabilities.statementAuthorizer) {
    throw Object.assign(
      new Error("This runtime does not provide Ether's required SQLite security controls."),
      {
        capabilities,
        code: ETHER_SQLITE_SECURITY_UNAVAILABLE
      }
    );
  }
  return database as HardenableDatabase;
}

function etherSqliteAuthorizer(
  actionCode: number,
  arg1: string | null,
  arg2: string | null
): number {
  if (actionCode === constants.SQLITE_ATTACH || actionCode === constants.SQLITE_DETACH) {
    return constants.SQLITE_DENY;
  }
  if (
    actionCode === constants.SQLITE_FUNCTION &&
    [arg1, arg2].some((value) => value?.toLowerCase() === "load_extension")
  ) {
    return constants.SQLITE_DENY;
  }
  return constants.SQLITE_OK;
}

/** Apply connection-local hardening before any document schema is evaluated. */
export function hardenEtherSqliteConnection(database: DatabaseSync): void {
  const hardenable = requireEtherSqliteSecurityCapabilities(database);
  database.exec("PRAGMA trusted_schema = OFF");
  const trustedSchema = database.prepare("PRAGMA trusted_schema").get() as Record<string, unknown>;
  if (Number(Object.values(trustedSchema)[0]) !== 0) {
    throw new Error("SQLite refused to disable trusted_schema.");
  }
  hardenable.enableDefensive!(true);
  hardenable.setAuthorizer!(etherSqliteAuthorizer);
}

/**
 * VACUUM INTO is Ether's only intentional attach-like operation. The raw
 * connection never crosses this closure and the authorizer is restored even
 * when SQLite or a failure-injection hook throws.
 */
export function withEtherVacuumCapability<T>(
  database: DatabaseSync,
  operation: () => T
): T {
  const hardenable = requireEtherSqliteSecurityCapabilities(database);
  hardenable.setAuthorizer!(null);
  try {
    return operation();
  } finally {
    hardenEtherSqliteConnection(database);
  }
}
