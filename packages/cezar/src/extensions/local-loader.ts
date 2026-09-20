import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  checkPackageCompatibility,
  isValidExtensionId,
  validatePackageManifest,
  type ExtensionPackageManifest,
  type HostIdentity,
} from '@open-mercato/cezar-extension-api';
import { extensionsDir, extensionGrantsPath } from '../paths.ts';
import { grantedPermissionsFor, permissionsCovered, readExtensionGrants } from './grants.ts';
import type { ExtensionDiagnostic, ExtensionInventoryEntry } from '@open-mercato/cezar-contract';

export const MAX_EXTENSION_MANIFEST_BYTES = 64 * 1024;
export const MAX_EXTENSION_ASSET_BYTES = 5 * 1024 * 1024;

export interface LocalExtensionScan {
  readonly scannedAt: string;
  readonly directory: '~/.cezar/extensions';
  readonly extensions: readonly ExtensionInventoryEntry[];
  readonly diagnostics: readonly ExtensionDiagnostic[];
}

export interface LocalExtensionScanOptions {
  readonly version: string;
  readonly root?: string;
  readonly grantsPath?: string;
  readonly log?: (message: string) => void;
}

const host = (release: string): HostIdentity => ({ apiVersions: [1], release, entrypoints: ['frontend'] });

function diagnostic(
  candidate: string,
  id: string | null,
  code: ExtensionDiagnostic['code'],
  message: string,
  path: string | null = null,
): ExtensionDiagnostic {
  return Object.freeze({ candidate, id, code, message: message.slice(0, 512), path: path?.slice(0, 256) ?? null });
}

function candidateName(name: string): string {
  return name.length <= 128 && !name.includes('/') && !name.includes('\\') && !name.includes('\0') ? name : '(unsafe candidate)';
}

function manifestId(value: unknown): string | null {
  const id = typeof value === 'object' && value !== null && 'id' in value ? (value as { id?: unknown }).id : undefined;
  return typeof id === 'string' && isValidExtensionId(id) ? id : null;
}

function emptyEntry(candidate: string, issue: ExtensionDiagnostic): ExtensionInventoryEntry {
  return {
    candidate,
    id: issue.id,
    name: null,
    version: null,
    description: null,
    entrypoints: { frontend: null, backend: null },
    status: 'rejected',
    requestedPermissions: [],
    grantedPermissions: [],
    frontendUrl: null,
    diagnostic: issue,
  };
}

function compatibilityDiagnostic(candidate: string, id: string, manifest: ExtensionPackageManifest, code: ExtensionDiagnostic['code'], message: string, path: string | null = null): ExtensionDiagnostic {
  return diagnostic(candidate, id, code, message, path);
}

async function safeFrontend(root: string, entrypoint: string): Promise<{ ok: true; path: string } | { ok: false; code: 'entrypoint-missing' | 'unsafe-path'; message: string }> {
  const packageRoot = await realpath(root);
  const target = resolve(root, entrypoint.slice(2));
  if (isAbsolute(entrypoint) || relative(root, target).startsWith('..')) {
    return { ok: false, code: 'unsafe-path', message: 'the frontend entrypoint leaves the package directory' };
  }
  let resolved: string;
  try {
    resolved = await realpath(target);
    const escaped = relative(packageRoot, resolved).startsWith('..');
    if (escaped) return { ok: false, code: 'unsafe-path', message: 'the frontend entrypoint resolves outside the package directory' };
    const info = await stat(resolved);
    if (!info.isFile()) return { ok: false, code: 'entrypoint-missing', message: 'the frontend entrypoint is not a file' };
    if (info.size > MAX_EXTENSION_ASSET_BYTES) return { ok: false, code: 'unsafe-path', message: 'the frontend entrypoint is too large' };
  } catch {
    return { ok: false, code: 'entrypoint-missing', message: 'the frontend entrypoint could not be read' };
  }
  return { ok: true, path: resolved };
}

/** Scans package metadata only. No extension module is imported here. */
export async function scanLocalExtensions(options: LocalExtensionScanOptions): Promise<LocalExtensionScan> {
  const root = options.root ?? extensionsDir();
  const diagnostics: ExtensionDiagnostic[] = [];
  const candidates: ExtensionInventoryEntry[] = [];
  const loaded = await readExtensionGrants(options.grantsPath ?? extensionGrantsPath());
  if (loaded.warning) options.log?.(`[cez:extensions] ${loaded.warning}`);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const issue = diagnostic('(extensions directory)', null, 'directory-unreadable', 'the local extension directory could not be read');
      diagnostics.push(issue);
      options.log?.(`[cez:extensions] ${issue.message}`);
    }
    return Object.freeze({ scannedAt: new Date().toISOString(), directory: '~/.cezar/extensions', extensions: Object.freeze([]), diagnostics: Object.freeze(diagnostics) });
  }

  for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = candidateName(dirent.name);
    if (candidate === '(unsafe candidate)') continue;
    const packageRoot = join(root, dirent.name);
    let issue: ExtensionDiagnostic | undefined;
    try {
      const rootStat = await lstat(packageRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        issue = diagnostic(candidate, null, 'unsafe-path', 'the candidate must be a real directory');
      }
    } catch {
      issue = diagnostic(candidate, null, 'directory-unreadable', 'the candidate directory could not be read');
    }
    if (issue) {
      diagnostics.push(issue);
      candidates.push(emptyEntry(candidate, issue));
      continue;
    }

    const manifestPath = join(packageRoot, 'cezar.extension.json');
    let text: string;
    try {
      const info = await stat(manifestPath);
      if (info.size > MAX_EXTENSION_MANIFEST_BYTES) {
        issue = diagnostic(candidate, null, 'manifest-too-large', 'the extension manifest is too large', 'cezar.extension.json');
        diagnostics.push(issue);
        candidates.push(emptyEntry(candidate, issue));
        continue;
      }
      text = await readFile(manifestPath, 'utf8');
    } catch {
      issue = diagnostic(candidate, null, 'manifest-missing', 'cezar.extension.json is missing', 'cezar.extension.json');
      diagnostics.push(issue);
      candidates.push(emptyEntry(candidate, issue));
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      issue = diagnostic(candidate, null, 'manifest-invalid-json', 'cezar.extension.json is not valid JSON', 'cezar.extension.json');
      diagnostics.push(issue);
      candidates.push(emptyEntry(candidate, issue));
      continue;
    }
    const id = manifestId(raw);
    const issues = validatePackageManifest(raw);
    if (issues.length > 0) {
      issue = diagnostic(candidate, id, 'manifest-invalid', issues[0]?.message ?? 'the extension manifest is invalid', issues[0]?.path || null);
      diagnostics.push(issue);
      candidates.push(emptyEntry(candidate, issue));
      continue;
    }
    const manifest = raw as ExtensionPackageManifest;
    const compatibility = checkPackageCompatibility(manifest, host(options.version));
    if (!compatibility.compatible) {
      const first = compatibility.issues[0]!;
      const code = first.code === 'malformed' ? 'manifest-invalid' : first.code;
      issue = compatibilityDiagnostic(candidate, manifest.id, manifest, code, first.message, 'path' in first ? first.path : null);
      diagnostics.push(issue);
      candidates.push({ ...emptyEntry(candidate, issue), id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description ?? null, entrypoints: { frontend: manifest.entrypoints.frontend, backend: manifest.entrypoints.backend ?? null }, requestedPermissions: [...(manifest.permissions ?? [])] });
      continue;
    }
    const frontend = await safeFrontend(packageRoot, manifest.entrypoints.frontend);
    if (!frontend.ok) {
      issue = diagnostic(candidate, manifest.id, frontend.code, frontend.message, manifest.entrypoints.frontend);
      diagnostics.push(issue);
      candidates.push({ ...emptyEntry(candidate, issue), id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description ?? null, entrypoints: { frontend: manifest.entrypoints.frontend, backend: manifest.entrypoints.backend ?? null }, requestedPermissions: [...(manifest.permissions ?? [])] });
      continue;
    }
    const requested = [...(manifest.permissions ?? [])];
    const granted = [...grantedPermissionsFor(loaded.grants, manifest.id, requested)];
    const approved = permissionsCovered(requested, granted);
    const pending = !approved;
    issue = pending ? diagnostic(candidate, manifest.id, 'permission-required', 'this extension needs explicit permission approval') : undefined;
    const body: ExtensionInventoryEntry = {
      candidate,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      entrypoints: { frontend: manifest.entrypoints.frontend, backend: manifest.entrypoints.backend ?? null },
      status: pending ? 'permission-required' : 'ready',
      requestedPermissions: requested,
      grantedPermissions: granted,
      frontendUrl: pending ? null : `/api/v1/extensions/${encodeURIComponent(manifest.id)}/assets/${manifest.entrypoints.frontend.slice(2)}`,
      diagnostic: issue ?? null,
    };
    if (issue) diagnostics.push(issue);
    candidates.push(body);
  }

  const byId = new Map<string, ExtensionInventoryEntry[]>();
  for (const entry of candidates) if (entry.id) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  for (const entriesForId of byId.values()) {
    if (entriesForId.length < 2) continue;
    for (const entry of entriesForId) {
      const duplicate = diagnostic(entry.candidate, entry.id, 'duplicate-id', `extension id ${entry.id} is provided by more than one package`);
      diagnostics.push(duplicate);
      const index = candidates.indexOf(entry);
      candidates[index] = { ...entry, status: 'duplicate', frontendUrl: null, diagnostic: duplicate };
    }
  }
  return Object.freeze({ scannedAt: new Date().toISOString(), directory: '~/.cezar/extensions', extensions: Object.freeze(candidates), diagnostics: Object.freeze(diagnostics) });
}
