import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  checkPackageCompatibility,
  validatePackageManifest,
  type ExtensionPackageManifest,
  type ExtensionPermission,
} from '@open-mercato/cezar-extension-api';
import { extensionsDir } from '../paths.ts';
import { effectiveGrantedPermissions, loadExtensionGrants, type ExtensionGrantStore } from './grants.ts';

export const EXTENSION_MANIFEST = 'cezar.extension.json';
export const MAX_EXTENSION_MANIFEST_BYTES = 256 * 1024;
export const MAX_EXTENSION_ASSET_BYTES = 5 * 1024 * 1024;

export type LocalExtensionDiagnosticCode =
  | 'directory-unreadable'
  | 'manifest-missing'
  | 'manifest-too-large'
  | 'manifest-invalid-json'
  | 'manifest-invalid'
  | 'unsupported-api-version'
  | 'unsupported-range'
  | 'release-out-of-range'
  | 'unsupported-entrypoint'
  | 'entrypoint-missing'
  | 'unsafe-path'
  | 'duplicate-id'
  | 'permission-required'
  | 'grant-store-unavailable';

export type LocalExtensionDiagnostic = {
  readonly candidate: string;
  readonly id: string | null;
  readonly code: LocalExtensionDiagnosticCode;
  readonly message: string;
  readonly path: string | null;
};

export type LocalExtensionStatus = 'ready' | 'permission-required' | 'rejected' | 'duplicate';

export type LocalExtensionEntry = {
  readonly candidate: string;
  readonly id: string | null;
  readonly name: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly entrypoints: { readonly frontend: string | null; readonly backend: string | null };
  readonly status: LocalExtensionStatus;
  readonly requestedPermissions: readonly string[];
  readonly grantedPermissions: readonly string[];
  readonly frontendUrl: string | null;
  readonly diagnostic: LocalExtensionDiagnostic | null;
  readonly packageRoot: string | null;
  readonly frontendPath: string | null;
};

export type LocalExtensionInventory = {
  readonly available: true;
  readonly directory: '~/.cezar/extensions';
  readonly scannedAt: string;
  readonly extensions: readonly LocalExtensionEntry[];
  readonly diagnostics: readonly LocalExtensionDiagnostic[];
  readonly grantsAvailable: boolean;
};

export type ScanLocalExtensionsOptions = {
  readonly root?: string;
  readonly grantsPath?: string;
  readonly release: string;
  readonly log?: (diagnostic: LocalExtensionDiagnostic) => void;
};

const emptyEntrypoints = Object.freeze({ frontend: null, backend: null });
const host = (release: string) => ({ apiVersions: [1], release, entrypoints: ['frontend'] as const });

function diagnostic(
  candidate: string,
  id: string | null,
  code: LocalExtensionDiagnosticCode,
  message: string,
  path: string | null,
): LocalExtensionDiagnostic {
  return Object.freeze({ candidate, id, code, message: message.slice(0, 512), path: path?.slice(0, 256) ?? null });
}

function compatibilityCode(code: string): LocalExtensionDiagnosticCode {
  if (code === 'unsupported-api-version' || code === 'unsupported-range' || code === 'release-out-of-range' || code === 'unsupported-entrypoint') {
    return code;
  }
  return 'manifest-invalid';
}

function freezeEntry(entry: LocalExtensionEntry): LocalExtensionEntry {
  return Object.freeze({
    ...entry,
    entrypoints: Object.freeze({ ...entry.entrypoints }),
    requestedPermissions: Object.freeze([...entry.requestedPermissions]),
    grantedPermissions: Object.freeze([...entry.grantedPermissions]),
  });
}

function baseEntry(candidate: string): LocalExtensionEntry {
  return freezeEntry({
    candidate,
    id: null,
    name: null,
    version: null,
    description: null,
    entrypoints: emptyEntrypoints,
    status: 'rejected',
    requestedPermissions: [],
    grantedPermissions: [],
    frontendUrl: null,
    diagnostic: null,
    packageRoot: null,
    frontendPath: null,
  });
}

function withDiagnostic(entry: LocalExtensionEntry, value: LocalExtensionDiagnostic, status: LocalExtensionStatus = 'rejected'): LocalExtensionEntry {
  return freezeEntry({ ...entry, status, diagnostic: value });
}

async function readManifest(root: string): Promise<{ readonly value?: unknown; readonly issue?: { code: LocalExtensionDiagnosticCode; message: string; path: string | null } }> {
  const path = join(root, EXTENSION_MANIFEST);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { issue: { code: 'manifest-missing', message: 'cezar.extension.json is missing', path: EXTENSION_MANIFEST } };
    return { issue: { code: 'manifest-invalid', message: 'cezar.extension.json cannot be read', path: EXTENSION_MANIFEST } };
  }
  if (bytes.byteLength > MAX_EXTENSION_MANIFEST_BYTES) return { issue: { code: 'manifest-too-large', message: 'cezar.extension.json is too large', path: EXTENSION_MANIFEST } };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { issue: { code: 'manifest-invalid-json', message: 'cezar.extension.json is not valid UTF-8', path: EXTENSION_MANIFEST } };
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { issue: { code: 'manifest-invalid-json', message: 'cezar.extension.json is not valid JSON', path: EXTENSION_MANIFEST } };
  }
}

async function safeEntrypoint(root: string, entrypoint: string): Promise<{ readonly path?: string; readonly code?: 'entrypoint-missing' | 'unsafe-path'; readonly message?: string }> {
  const candidate = join(root, entrypoint.slice(2).split('/').join(sep));
  const rootReal = await realpath(root).catch(() => null);
  if (rootReal === null) return { code: 'unsafe-path', message: 'the package root cannot be resolved' };
  const requested = relative(rootReal, candidate);
  if (requested.startsWith('..') || requested.includes(`..${sep}`) || requested.includes('\0')) {
    return { code: 'unsafe-path', message: 'the frontend entrypoint leaves the package root' };
  }
  try {
    const info = await lstat(candidate);
    const resolved = await realpath(candidate);
    const inside = resolved === rootReal || resolved.startsWith(`${rootReal}${sep}`);
    if (!inside) return { code: 'unsafe-path', message: 'the frontend entrypoint leaves the package root' };
    if (!info.isFile() && !info.isSymbolicLink()) return { code: 'entrypoint-missing', message: 'the frontend entrypoint is not a file' };
    const fileInfo = await stat(resolved);
    if (fileInfo.size > MAX_EXTENSION_ASSET_BYTES) return { code: 'unsafe-path', message: 'the frontend entrypoint is too large' };
    return { path: resolved };
  } catch {
    return { code: 'entrypoint-missing', message: 'the frontend entrypoint is missing' };
  }
}

async function classifyCandidate(
  candidate: string,
  root: string,
  grants: ExtensionGrantStore,
  release: string,
): Promise<LocalExtensionEntry> {
  let entry = baseEntry(candidate);
  const manifestResult = await readManifest(root);
  if (manifestResult.issue) {
    return withDiagnostic(entry, diagnostic(candidate, null, manifestResult.issue.code, manifestResult.issue.message, manifestResult.issue.path));
  }

  const issues = validatePackageManifest(manifestResult.value);
  const raw = manifestResult.value as Record<string, unknown>;
  const rawId = typeof raw.id === 'string' ? raw.id : null;
  if (issues.length > 0) {
    const issue = issues[0];
    if (issue === undefined) return withDiagnostic({ ...entry, id: rawId }, diagnostic(candidate, rawId, 'manifest-invalid', 'manifest validation failed', null));
    return withDiagnostic(
      { ...entry, id: rawId },
      diagnostic(candidate, rawId, 'manifest-invalid', issue.message, issue.path || null),
    );
  }

  const manifest = manifestResult.value as ExtensionPackageManifest;
  const requested = (manifest.permissions ?? []) as readonly ExtensionPermission[];
  entry = freezeEntry({
    ...entry,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? null,
    entrypoints: { frontend: manifest.entrypoints.frontend, backend: manifest.entrypoints.backend ?? null },
    requestedPermissions: requested,
    packageRoot: root,
  });

  const compatibility = checkPackageCompatibility(manifest, host(release));
  if (!compatibility.compatible) {
    const issue = compatibility.issues[0];
    if (issue === undefined) return withDiagnostic(entry, diagnostic(candidate, manifest.id, 'manifest-invalid', 'package compatibility could not be determined', null));
    return withDiagnostic(entry, diagnostic(candidate, manifest.id, compatibilityCode(issue.code), issue.message, 'path' in issue ? issue.path : null));
  }

  const frontend = await safeEntrypoint(root, manifest.entrypoints.frontend);
  if (!frontend.path) {
    return withDiagnostic(entry, diagnostic(candidate, manifest.id, frontend.code ?? 'entrypoint-missing', frontend.message ?? 'the frontend entrypoint is unavailable', manifest.entrypoints.frontend));
  }

  const granted = effectiveGrantedPermissions(grants, manifest.id, requested);
  if (requested.length > granted.length) {
    const code = grants.available ? 'permission-required' : 'grant-store-unavailable';
    const message = grants.available
      ? `permissions require approval: ${requested.join(', ')}`
      : 'the extension permission file is unavailable; permissions remain unapproved';
    return withDiagnostic({ ...entry, grantedPermissions: granted, frontendPath: frontend.path }, diagnostic(candidate, manifest.id, code, message, null), 'permission-required');
  }
  return freezeEntry({ ...entry, status: 'ready', grantedPermissions: granted, frontendPath: frontend.path });
}

/** Scan direct child package directories without importing any package code. */
export async function scanLocalExtensions(options: ScanLocalExtensionsOptions): Promise<LocalExtensionInventory> {
  const root = options.root ?? extensionsDir();
  const grants = await loadExtensionGrants(options.grantsPath);
  let entries: LocalExtensionEntry[] = [];
  try {
    const candidates = await readdir(root, { withFileTypes: true });
    for (const candidate of candidates) {
      if (!candidate.isDirectory()) continue;
      const packageRoot = join(root, candidate.name);
      entries.push(await classifyCandidate(candidate.name, packageRoot, grants, options.release));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const item = diagnostic('(extensions)', null, 'directory-unreadable', 'the local extension directory cannot be read', null);
      options.log?.(item);
      return Object.freeze({ available: true, directory: '~/.cezar/extensions', scannedAt: new Date().toISOString(), extensions: [], diagnostics: [item], grantsAvailable: grants.available });
    }
  }

  const byId = new Map<string, LocalExtensionEntry[]>();
  for (const entry of entries) {
    if (entry.id === null) continue;
    const group = byId.get(entry.id) ?? [];
    group.push(entry);
    byId.set(entry.id, group);
  }
  for (const group of byId.values()) {
    if (group.length < 2) continue;
    for (const duplicate of group) {
      const value = diagnostic(duplicate.candidate, duplicate.id, 'duplicate-id', `extension id ${duplicate.id} is provided by more than one package`, null);
      entries = entries.map((entry) => entry.candidate === duplicate.candidate ? withDiagnostic(entry, value, 'duplicate') : entry);
      options.log?.(value);
    }
  }

  const diagnostics = entries.flatMap((entry) => entry.diagnostic ? [entry.diagnostic] : []);
  for (const item of diagnostics) options.log?.(item);
  return Object.freeze({
    available: true,
    directory: '~/.cezar/extensions',
    scannedAt: new Date().toISOString(),
    extensions: Object.freeze(entries),
    diagnostics: Object.freeze(diagnostics),
    grantsAvailable: grants.available,
  });
}
