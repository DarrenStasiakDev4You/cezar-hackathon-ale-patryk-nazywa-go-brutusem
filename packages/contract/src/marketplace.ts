import { z } from 'zod';

/** Bounds shared by the external catalog parser and its wire contract. */
export const MARKETPLACE_MAX_DOCUMENT_BYTES = 1_000_000;
export const MARKETPLACE_MAX_EXTENSIONS = 100;
export const MARKETPLACE_MAX_VERSIONS_PER_EXTENSION = 50;
export const MARKETPLACE_MAX_PERMISSIONS = 32;
export const MARKETPLACE_MAX_DESCRIPTION_LENGTH = 2_000;
export const MARKETPLACE_MAX_URL_LENGTH = 2_048;
export const MARKETPLACE_MAX_RANGE_LENGTH = 64;

const extensionIdPattern = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const rangePart = '(?:0|[1-9]\\d*|[xX*])';
const rangeTokenPattern = new RegExp(`^(?:\\^|~|>=|<=|>|<|=)?${rangePart}(?:\\.${rangePart}){0,2}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const sha256Pattern = /^[0-9a-f]{64}$/;
const httpsUrlPattern = /^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/;
const MARKETPLACE_PERMISSIONS = [
  'ui.components',
  'commands.execute',
  'storage',
  'events',
  'network',
  'notifications',
] as const;

function isAbsoluteHttpsUrl(value: string): boolean {
  return httpsUrlPattern.test(value);
}

function isConcreteReleaseUrl(value: string): boolean {
  if (!isAbsoluteHttpsUrl(value)) return false;
  const authorityAndPath = value.slice('https://'.length).split(/[?#]/, 1)[0] ?? '';
  const slash = authorityAndPath.indexOf('/');
  if (slash < 0) return false;
  const pathname = authorityAndPath.slice(slash).toLowerCase();
  return pathname.length > 1 && !/(?:^|\/)releases\/latest(?:\/|$)/.test(pathname);
}

function isSupportedRange(value: string): boolean {
  const alternatives = value.trim().split('||');
  return alternatives.length > 0 && alternatives.length <= 8 && alternatives.every((alternative) => {
    const tokens = alternative.trim().split(/\s+/);
    return tokens.length > 0 && tokens.every((token) => rangeTokenPattern.test(token));
  });
}

export const marketplaceExtensionVersionSchema = z.object({
  version: z.string().regex(semverPattern),
  compatibility: z.object({
    apiVersion: z.number().int().positive(),
    cezar: z.string().trim().min(1).max(MARKETPLACE_MAX_RANGE_LENGTH).refine(isSupportedRange),
  }).strict(),
  permissions: z.array(z.enum(MARKETPLACE_PERMISSIONS)).max(MARKETPLACE_MAX_PERMISSIONS)
    .refine((permissions) => new Set(permissions).size === permissions.length),
  releaseUrl: z.string().max(MARKETPLACE_MAX_URL_LENGTH).refine(isConcreteReleaseUrl),
  checksum: z.object({
    algorithm: z.literal('sha256'),
    value: z.string().regex(sha256Pattern),
  }).strict(),
}).strict();

export const marketplaceExtensionMetadataSchema = z.object({
  id: z.string().min(3).max(64).regex(extensionIdPattern),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(MARKETPLACE_MAX_DESCRIPTION_LENGTH),
  publisher: z.object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
  }).strict(),
  repository: z.string().max(MARKETPLACE_MAX_URL_LENGTH).refine(isAbsoluteHttpsUrl),
}).strict();

export const marketplaceExtensionSchema = marketplaceExtensionMetadataSchema.extend({
  versions: z.array(marketplaceExtensionVersionSchema).min(1).max(MARKETPLACE_MAX_VERSIONS_PER_EXTENSION),
}).strict().superRefine((extension, ctx) => {
  const versions = new Set<string>();
  for (const version of extension.versions) {
    if (versions.has(version.version)) {
      ctx.addIssue({ code: 'custom', path: ['versions'], message: 'versions must be unique' });
      return;
    }
    versions.add(version.version);
  }
});
export type MarketplaceExtension = z.infer<typeof marketplaceExtensionSchema>;
export type MarketplaceExtensionVersion = MarketplaceExtension['versions'][number];

const marketplaceEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  extensions: z.array(marketplaceExtensionSchema).max(MARKETPLACE_MAX_EXTENSIONS),
}).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const extension of catalog.extensions) {
    if (ids.has(extension.id)) {
      ctx.addIssue({ code: 'custom', path: ['extensions'], message: 'extension ids must be unique' });
      return;
    }
    ids.add(extension.id);
  }
});

/** The complete canonical marketplace document, also suitable for contract consumers. */
export const marketplaceCatalogSchema = marketplaceEnvelopeSchema;
export type MarketplaceCatalog = z.infer<typeof marketplaceCatalogSchema>;

/** The successful response from `GET /api/v1/extensions/marketplace`. */
export const marketplaceAvailableResponseSchema = z.object({
  available: z.literal(true),
  source: z.string().max(MARKETPLACE_MAX_URL_LENGTH).refine(isAbsoluteHttpsUrl),
  fetchedAt: z.string().datetime({ offset: true }),
  partial: z.boolean(),
  extensions: z.array(marketplaceExtensionSchema).max(MARKETPLACE_MAX_EXTENSIONS),
}).strict();

/** Stable failure response; upstream details never cross the service boundary. */
export const marketplaceUnavailableResponseSchema = z.object({
  available: z.literal(false),
  reason: z.literal('marketplace registry is unavailable'),
}).strict();

export const marketplaceCatalogResponseSchema = z.discriminatedUnion('available', [
  marketplaceAvailableResponseSchema,
  marketplaceUnavailableResponseSchema,
]);
export type MarketplaceCatalogResponse = z.infer<typeof marketplaceCatalogResponseSchema>;

/** The parser uses this header to salvage malformed individual extension entries. */
export const marketplaceCatalogEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  extensions: z.array(z.unknown()).max(MARKETPLACE_MAX_EXTENSIONS),
}).strict();
