export interface SensitiveTextReplacements {
  email: string;
  localPath: string;
  networkPath: string;
  secret: string;
}

const DEFAULT_REPLACEMENTS: SensitiveTextReplacements = {
  email: "[EMAIL]",
  localPath: "[LOCAL_PATH]",
  networkPath: "[NETWORK_PATH]",
  secret: "[REDACTED]"
};

const STRUCTURED_SLASH_PREFIX = /^\/(?:api|components|definitions|properties|schemas|v\d+)(?:\/|$)/iu;
const SECRET_LABEL = /\b(api[ _-]?key|access[ _-]?token|authorization|bearer[ _-]?token|credential|password|refresh[ _-]?token|secret|token)\b\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;)\]}]+)/giu;

function pathReplacement(
  candidate: string,
  replacements: SensitiveTextReplacements,
  redactFileUris: boolean
): string | null {
  if (/^file:\/\//iu.test(candidate)) {
    return redactFileUris ? replacements.localPath : null;
  }
  if (/^\\\\/u.test(candidate) || /^\/\/[^/]/u.test(candidate)) {
    return replacements.networkPath;
  }
  if (/^[A-Za-z]:[\\/]/u.test(candidate)) return replacements.localPath;
  if (candidate.startsWith("/") && !STRUCTURED_SLASH_PREFIX.test(candidate)) {
    const pathOnly = candidate.replace(/[),.;:!?]+$/u, "");
    if (pathOnly.includes("/", 1)) {
      return `${replacements.localPath}${candidate.slice(pathOnly.length)}`;
    }
  }
  return null;
}

function redactQuotedPaths(
  value: string,
  replacements: SensitiveTextReplacements,
  redactFileUris: boolean
): string {
  return value.replace(/(["'])(file:\/\/[^"'<>]*|[A-Za-z]:[\\/][^"'<>|]*|\\\\[^"'<>]*|\/[^"'<>]*)\1/giu,
    (match, quote: string, candidate: string) => {
      const replacement = pathReplacement(candidate, replacements, redactFileUris);
      return replacement === null ? match : `${quote}${replacement}${quote}`;
    });
}

function redactUnquotedPosixPaths(
  value: string,
  replacements: SensitiveTextReplacements,
  redactFileUris: boolean
): string {
  return value.replace(/\/[^\s"'<>]*/gu, (candidate, offset: number, source: string) => {
    const previous = offset === 0 ? "" : source[offset - 1]!;
    if (
      candidate.startsWith("//") ||
      previous === ":" ||
      previous === "/" ||
      /[A-Za-z0-9]/u.test(previous) ||
      STRUCTURED_SLASH_PREFIX.test(candidate)
    ) {
      return candidate;
    }
    return pathReplacement(candidate, replacements, redactFileUris) ?? candidate;
  });
}

const SPACED_PATH_TERMINATOR = String.raw`(?=$|[,;)\]}!?](?:\s|$)|\s+(?:and|but|because|during|failed|while|with)\b)`;

function redactUnquotedSpacedPaths(
  value: string,
  replacements: SensitiveTextReplacements
): string {
  const windows = new RegExp(
    String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/][^"'<>|\r\n]*?\.[A-Za-z0-9]{1,12}${SPACED_PATH_TERMINATOR}`,
    "giu"
  );
  const network = new RegExp(
    String.raw`\\\\[^"'<>|\r\n]*?\.[A-Za-z0-9]{1,12}${SPACED_PATH_TERMINATOR}`,
    "gu"
  );
  const posix = new RegExp(
    String.raw`(^|[\s("'=])(/[^"'<>|\r\n]*?\.[A-Za-z0-9]{1,12})${SPACED_PATH_TERMINATOR}`,
    "giu"
  );
  return value
    .replace(windows, replacements.localPath)
    .replace(network, replacements.networkPath)
    .replace(posix, (match, prefix: string, candidate: string) =>
      STRUCTURED_SLASH_PREFIX.test(candidate)
        ? match
        : `${prefix}${replacements.localPath}`
    );
}

const PATH_CONTEXT_BOUNDARY =
  /\s+(?:and|because|but|cannot|could|during|failed|is|was|while|with)\b/iu;

function boundedPathEnd(value: string, start: number): number {
  const bounded = value.slice(start, start + 1_024);
  const structuralEnd = bounded.search(/[\r\n"'<>|,;)\]}!?]/u);
  const contextEnd = bounded.search(PATH_CONTEXT_BOUNDARY);
  const candidates = [structuralEnd, contextEnd].filter((index) => index >= 0);
  const relativeEnd = candidates.length === 0 ? bounded.length : Math.min(...candidates);
  let end = start + relativeEnd;
  while (end > start && /\s/u.test(value[end - 1]!)) end -= 1;
  return end;
}

function redactExtensionlessSpacedPaths(
  value: string,
  replacements: SensitiveTextReplacements
): string {
  const starts: Array<{ index: number; kind: "local" | "network"; prefixLength: number }> = [];
  for (const match of value.matchAll(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/gu)) {
    starts.push({ index: match.index!, kind: "local", prefixLength: 3 });
  }
  for (const match of value.matchAll(/\\\\[^\\\s]+\\[^\\\s]+/gu)) {
    starts.push({ index: match.index!, kind: "network", prefixLength: match[0].length });
  }
  for (const match of value.matchAll(/(^|[\s("'=])(\/(?!\/))/gu)) {
    const index = match.index! + match[1]!.length;
    const previous = index === 0 ? "" : value[index - 1]!;
    if (previous === ":" || previous === "/") continue;
    starts.push({ index, kind: "local", prefixLength: 1 });
  }
  starts.sort((left, right) => left.index - right.index);

  let cursor = 0;
  let redacted = "";
  for (const start of starts) {
    if (start.index < cursor) continue;
    const end = boundedPathEnd(value, start.index);
    const candidate = value.slice(start.index, end);
    if (candidate.length <= start.prefixLength || STRUCTURED_SLASH_PREFIX.test(candidate)) continue;
    const separators = candidate.match(/[\\/]/gu)?.length ?? 0;
    const rootLevelSpacedLocal =
      start.kind === "local" &&
      /\s/u.test(candidate.slice(start.prefixLength)) &&
      (
        (candidate.startsWith("/") && separators === 1) ||
        (/^[A-Za-z]:/u.test(candidate) && separators === 1)
      );
    if (
      (start.kind === "local" && candidate.startsWith("/") && separators < 2 && !rootLevelSpacedLocal) ||
      (start.kind === "local" && /^[A-Za-z]:/u.test(candidate) && separators < 2 && !rootLevelSpacedLocal) ||
      (start.kind === "network" && separators < 3)
    ) {
      continue;
    }
    redacted += value.slice(cursor, start.index);
    redacted += start.kind === "network" ? replacements.networkPath : replacements.localPath;
    cursor = end;
  }
  return `${redacted}${value.slice(cursor)}`;
}

/**
 * Shared main/IPC redaction. Labels are matched as complete components so
 * benign names such as `tokenCount` and `secretary` are not treated as
 * credentials. Quoted absolute paths may contain spaces.
 */
export function redactSensitiveText(
  value: string,
  replacements: SensitiveTextReplacements = DEFAULT_REPLACEMENTS,
  redactFileUris = false
): string {
  const secrets = value
    .replace(/\bBearer\s+("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu, `Bearer ${replacements.secret}`)
    .replace(SECRET_LABEL, (_match, label: string) => `${label}=${replacements.secret}`)
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/giu, replacements.secret);
  const quoted = redactQuotedPaths(secrets, replacements, redactFileUris);
  const spaced = redactUnquotedSpacedPaths(quoted, replacements);
  const extensionless = redactExtensionlessSpacedPaths(spaced, replacements);
  return redactUnquotedPosixPaths(extensionless
    .replace(/file:\/\/[^\s"']+/giu, (candidate) =>
      redactFileUris ? replacements.localPath : candidate
    )
    .replace(/\\\\[^\\\s"']+\\(?:[^\\\r\n"']+\\)*[^\\\r\n"']+/gu, replacements.networkPath)
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:[^\\/\s"'<>|]+[\\/])*[^\\/\s"'<>|]*/gu, replacements.localPath)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, replacements.email),
  replacements,
  redactFileUris);
}

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearertoken",
  "credential",
  "password",
  "refreshtoken",
  "secret",
  "token"
]);

export function isSensitiveStructuredKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLocaleLowerCase().replace(/[\s_-]/gu, ""));
}
