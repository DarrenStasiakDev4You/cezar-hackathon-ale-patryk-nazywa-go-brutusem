import { z } from 'zod';

const extensionDiagnosticCodes = [
  'directory-unreadable',
  'manifest-missing',
  'manifest-too-large',
  'manifest-invalid-json',
  'manifest-invalid',
  'unsupported-api-version',
  'unsupported-range',
  'release-out-of-range',
  'unsupported-entrypoint',
  'entrypoint-missing',
  'unsafe-path',
  'duplicate-id',
  'permission-required',
  'grant-store-unavailable',
] as const;

export const extensionDiagnosticCodeSchema = z.enum(extensionDiagnosticCodes);

export const extensionDiagnosticSchema = z.object({
  candidate: z.string(),
  id: z.string().nullable(),
  code: extensionDiagnosticCodeSchema,
  message: z.string(),
  path: z.string().nullable(),
});
export type ExtensionDiagnostic = z.infer<typeof extensionDiagnosticSchema>;

export const extensionInventoryEntrySchema = z.object({
  candidate: z.string(),
  id: z.string().nullable(),
  name: z.string().nullable(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  entrypoints: z.object({
    frontend: z.string().nullable(),
    backend: z.string().nullable(),
  }),
  status: z.enum(['ready', 'permission-required', 'rejected', 'duplicate']),
  requestedPermissions: z.array(z.string()),
  grantedPermissions: z.array(z.string()),
  frontendUrl: z.string().nullable(),
  diagnostic: extensionDiagnosticSchema.nullable(),
});
export type ExtensionInventoryEntry = z.infer<typeof extensionInventoryEntrySchema>;

const extensionInventoryAvailableSchema = z.object({
  available: z.literal(true),
  directory: z.literal('~/.cezar/extensions'),
  scannedAt: z.string(),
  extensions: z.array(extensionInventoryEntrySchema),
  diagnostics: z.array(extensionDiagnosticSchema),
  canApprove: z.boolean(),
});

const extensionInventoryUnavailableSchema = z.object({
  available: z.literal(false),
  reason: z.enum(['hosted-mode', 'local-handoff-unavailable']),
  extensions: z.array(extensionInventoryEntrySchema).length(0),
  diagnostics: z.array(extensionDiagnosticSchema).length(0),
  canApprove: z.literal(false),
});

export const extensionInventoryResponseSchema = z.discriminatedUnion('available', [
  extensionInventoryAvailableSchema,
  extensionInventoryUnavailableSchema,
]);
export type ExtensionInventoryResponse = z.infer<typeof extensionInventoryResponseSchema>;

export const extensionDiagnosticsResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    scannedAt: z.string(),
    diagnostics: z.array(extensionDiagnosticSchema),
  }),
  z.object({
    available: z.literal(false),
    reason: z.enum(['hosted-mode', 'local-handoff-unavailable']),
    diagnostics: z.array(z.never()).length(0),
  }),
]);
export type ExtensionDiagnosticsResponse = z.infer<typeof extensionDiagnosticsResponseSchema>;

export const extensionEndpointsResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    apiVersion: z.literal('1'),
    endpoints: z.object({
      inventory: z.literal('/api/v1/extensions'),
      diagnostics: z.literal('/api/v1/extensions/diagnostics'),
      approval: z.literal('/api/v1/extensions/:id/approval'),
      assets: z.literal('/api/v1/extensions/:id/assets/*path'),
    }),
  }),
  z.object({
    available: z.literal(false),
    apiVersion: z.literal('1'),
    reason: z.enum(['hosted-mode', 'local-handoff-unavailable']),
    endpoints: z.array(z.never()).length(0),
  }),
]);
export type ExtensionEndpointsResponse = z.infer<typeof extensionEndpointsResponseSchema>;

export const setExtensionApprovalInputSchema = z.object({ approved: z.boolean() }).strict();
export type SetExtensionApprovalInput = z.infer<typeof setExtensionApprovalInputSchema>;
