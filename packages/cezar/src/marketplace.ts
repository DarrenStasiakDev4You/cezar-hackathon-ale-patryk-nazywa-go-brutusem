import {
  MARKETPLACE_MAX_DOCUMENT_BYTES,
  marketplaceCatalogEnvelopeSchema,
  marketplaceExtensionSchema,
  marketplaceExtensionMetadataSchema,
  marketplaceExtensionVersionSchema,
  type MarketplaceCatalogResponse,
  type MarketplaceCatalog,
  type MarketplaceExtension,
  type MarketplaceExtensionVersion,
} from '@open-mercato/cezar-contract';

export type ParsedMarketplaceCatalog = Pick<MarketplaceCatalog, 'schemaVersion' | 'generatedAt' | 'extensions'> & {
  readonly partial: boolean;
};

export const MARKETPLACE_REGISTRY_URL = 'https://registry.example.invalid/cezar/extensions.json';
export const MARKETPLACE_FETCH_TIMEOUT_MS = 3_000;
export const MARKETPLACE_CACHE_TTL_MS = 5 * 60_000;

const INVALID_RESULT = null;
const semverPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function compareSemver(left: string, right: string): number {
  const leftMatch = semverPattern.exec(left);
  const rightMatch = semverPattern.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  for (const index of [1, 2, 3]) {
    const difference = Number(rightMatch[index]) - Number(leftMatch[index]);
    if (difference !== 0) return difference;
  }
  const leftPrerelease = leftMatch[4];
  const rightPrerelease = rightMatch[4];
  if (leftPrerelease === undefined && rightPrerelease === undefined) return 0;
  if (leftPrerelease === undefined) return -1;
  if (rightPrerelease === undefined) return 1;
  const leftParts = leftPrerelease.split('.');
  const rightParts = rightPrerelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return 1;
    if (rightPart === undefined) return -1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return rightNumber - leftNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return rightPart.localeCompare(leftPart);
  }
  return 0;
}

function byteLengthOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Validates a decoded catalog while salvaging valid extension/version records. The returned
 * entries have passed the same contract schemas used by the HTTP response; no package bytes are
 * read or executed here.
 */
export function parseMarketplaceCatalog(value: unknown, documentBytes?: number): ParsedMarketplaceCatalog | null {
  if (documentBytes !== undefined && documentBytes > MARKETPLACE_MAX_DOCUMENT_BYTES) return INVALID_RESULT;
  const envelope = marketplaceCatalogEnvelopeSchema.safeParse(value);
  if (!envelope.success) return INVALID_RESULT;

  let partial = false;
  const candidates: MarketplaceExtension[] = [];
  for (const rawExtension of envelope.data.extensions) {
    if (typeof rawExtension !== 'object' || rawExtension === null || Array.isArray(rawExtension)) {
      partial = true;
      continue;
    }
    const source = rawExtension as Record<string, unknown>;
    const versions = source.versions;
    if (!Array.isArray(versions) || versions.length === 0 || versions.length > 50) {
      partial = true;
      continue;
    }
    const metadata = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'versions'));
    const parsedMetadata = marketplaceExtensionMetadataSchema.safeParse(metadata);
    if (!parsedMetadata.success) {
      partial = true;
      continue;
    }

    const validVersions: MarketplaceExtensionVersion[] = [];
    const versionGroups = new Map<string, MarketplaceExtensionVersion[]>();
    for (const rawVersion of versions) {
      const parsedVersion = marketplaceExtensionVersionSchema.safeParse(rawVersion);
      if (!parsedVersion.success) {
        partial = true;
        continue;
      }
      const group = versionGroups.get(parsedVersion.data.version) ?? [];
      group.push(parsedVersion.data);
      versionGroups.set(parsedVersion.data.version, group);
    }
    for (const group of versionGroups.values()) {
      if (group.length !== 1) {
        partial = true;
        continue;
      }
      validVersions.push(group[0]!);
    }
    if (validVersions.length === 0) {
      partial = true;
      continue;
    }
    validVersions.sort((left, right) => compareSemver(left.version, right.version));
    const parsedExtension = marketplaceExtensionSchema.safeParse({
      ...parsedMetadata.data,
      versions: validVersions,
    });
    if (!parsedExtension.success) {
      partial = true;
      continue;
    }
    candidates.push(parsedExtension.data);
  }

  const extensionGroups = new Map<string, MarketplaceExtension[]>();
  for (const extension of candidates) {
    const group = extensionGroups.get(extension.id) ?? [];
    group.push(extension);
    extensionGroups.set(extension.id, group);
  }
  const extensions = [...extensionGroups.entries()]
    .filter(([, group]) => {
      if (group.length !== 1) {
        partial = true;
        return false;
      }
      return true;
    })
    .map(([, group]) => group[0]!)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: envelope.data.schemaVersion,
    generatedAt: envelope.data.generatedAt,
    extensions,
    partial,
  };
}

/** Parse a UTF-8 JSON document and enforce its byte cap before JSON allocation can grow further. */
export function parseMarketplaceCatalogJson(text: string): ParsedMarketplaceCatalog | null {
  const bytes = byteLengthOf(text);
  if (bytes === undefined || bytes > MARKETPLACE_MAX_DOCUMENT_BYTES) return INVALID_RESULT;
  try {
    return parseMarketplaceCatalog(JSON.parse(text), bytes);
  } catch {
    return INVALID_RESULT;
  }
}

export type MarketplaceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MarketplaceRegistryOptions {
  /** Dependency injection keeps network behavior hermetic in service tests. */
  readonly fetch?: MarketplaceFetch;
  readonly sourceUrl?: string;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface MarketplaceRegistry {
  read(): Promise<MarketplaceCatalogResponse>;
}

const unavailable = (): MarketplaceCatalogResponse => ({
  available: false,
  reason: 'marketplace registry is unavailable',
});

async function readResponseBody(response: Response): Promise<string | null> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length > MARKETPLACE_MAX_DOCUMENT_BYTES) return null;
  }
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MARKETPLACE_MAX_DOCUMENT_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MARKETPLACE_MAX_DOCUMENT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The on-demand marketplace reader. It only contacts the compiled source, refuses redirects, and
 * retains successful metadata in memory for a short bounded period. Failures are deliberately not
 * cached so a transient outage can recover on the next explicit request.
 */
export function createMarketplaceRegistry(options: MarketplaceRegistryOptions = {}): MarketplaceRegistry {
  const sourceUrl = options.sourceUrl ?? MARKETPLACE_REGISTRY_URL;
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? MARKETPLACE_FETCH_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? MARKETPLACE_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const onDiagnostic = options.onDiagnostic ?? ((message: string) => console.warn(`[cezar:marketplace] ${message}`));
  let cached: { response: MarketplaceCatalogResponse; at: number } | undefined;
  let inFlight: Promise<MarketplaceCatalogResponse> | undefined;

  const read = async (): Promise<MarketplaceCatalogResponse> => {
    const current = now();
    if (cached && current - cached.at < cacheTtlMs) return cached.response;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        const response = await fetchImpl(sourceUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (response.status >= 300 && response.status < 400) return unavailable();
        if (!response.ok) return unavailable();
        if (response.url !== '' && response.url !== sourceUrl) return unavailable();
        const text = await readResponseBody(response);
        if (text === null) return unavailable();
        const parsed = parseMarketplaceCatalogJson(text);
        if (parsed === null) return unavailable();
        if (parsed.partial) onDiagnostic('partial catalog; invalid entries were omitted');
        const responseBody: MarketplaceCatalogResponse = {
          available: true,
          source: sourceUrl,
          fetchedAt: new Date(now()).toISOString(),
          partial: parsed.partial,
          extensions: parsed.extensions,
        };
        cached = { response: responseBody, at: now() };
        return responseBody;
      } catch {
        return unavailable();
      } finally {
        clearTimeout(timer);
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  return { read };
}

/** One explicit read for callers that do not need to retain a service instance. */
export function fetchMarketplaceCatalog(options: MarketplaceRegistryOptions = {}): Promise<MarketplaceCatalogResponse> {
  return createMarketplaceRegistry(options).read();
}
