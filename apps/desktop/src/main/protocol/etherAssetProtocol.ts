export interface EtherAssetDescriptor {
  byteLength: number;
  contentHash: string;
  mediaType: string;
}

export interface EtherAssetSource {
  authorize(documentId: string, artifactId: string, variant: string): Promise<EtherAssetDescriptor | null>;
  streamRange(
    documentId: string,
    artifactId: string,
    variant: string,
    start: number,
    endExclusive: number
  ): AsyncIterable<Uint8Array>;
}

export interface EtherProtocolRegistrar {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string;
    privileges: {
      bypassCSP: boolean;
      corsEnabled: boolean;
      secure: boolean;
      standard: boolean;
      stream: boolean;
      supportFetchAPI: boolean;
    };
  }>): void;
}

export function registerEtherAssetScheme(registrar: EtherProtocolRegistrar): void {
  registrar.registerSchemesAsPrivileged([{
    scheme: "ether-asset",
    privileges: {
      bypassCSP: false,
      corsEnabled: false,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }]);
}

type ParsedRange = { start: number; endExclusive: number };

function parseIdentifier(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    decoded === "." ||
    decoded === ".." ||
    /[\\/%]/.test(decoded) ||
    /%2f|%5c/i.test(value)
  ) return null;
  return decoded;
}

function parseRange(value: string, byteLength: number): ParsedRange | null {
  if (!/^bytes=/.test(value) || value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, byteLength - suffixLength), endExclusive: byteLength };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? byteLength - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= byteLength ||
    requestedEnd < start
  ) return null;
  return { start, endExclusive: Math.min(byteLength, requestedEnd + 1) };
}

export function createEtherAssetProtocolHandler(source: EtherAssetSource) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const rawPath = request.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split(/[?#]/, 1)[0] ?? "";
    if (rawPath.split("/").some((segment) => segment === "." || segment === "..")) {
      return new Response(null, { status: 400 });
    }
    const url = new URL(request.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    const documentId = parseIdentifier(url.hostname);
    if (documentId === null || rawParts.length !== 2) return new Response(null, { status: 400 });
    const artifactId = parseIdentifier(rawParts[0]!);
    const variant = parseIdentifier(rawParts[1]!);
    if (artifactId === null || variant === null) return new Response(null, { status: 400 });
    const descriptor = await source.authorize(documentId, artifactId, variant);
    if (descriptor === null) return new Response(null, { status: 404 });

    const etag = `"${descriptor.contentHash}"`;
    const commonHeaders = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": descriptor.mediaType,
      ETag: etag
    };
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: commonHeaders });
    }

    const rangeHeader = request.headers.get("Range");
    let range: ParsedRange = { start: 0, endExclusive: descriptor.byteLength };
    let status = 200;
    const headers = new Headers(commonHeaders);
    if (rangeHeader !== null) {
      const parsed = parseRange(rangeHeader, descriptor.byteLength);
      if (parsed === null) {
        headers.set("Content-Range", `bytes */${descriptor.byteLength}`);
        return new Response(null, { status: 416, headers });
      }
      range = parsed;
      status = 206;
      headers.set("Content-Range", `bytes ${range.start}-${range.endExclusive - 1}/${descriptor.byteLength}`);
    }
    headers.set("Content-Length", String(range.endExclusive - range.start));
    const body = request.method === "HEAD"
      ? null
      : createRangeStream(source.streamRange(
          documentId,
          artifactId,
          variant,
          range.start,
          range.endExclusive
        ));
    return new Response(body, { status, headers });
  };
}

function createRangeStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    }
  }, { highWaterMark: 0 });
}
