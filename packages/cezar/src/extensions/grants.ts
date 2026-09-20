import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ExtensionPermission } from '@open-mercato/cezar-extension-api';
import { assertCezarHomeWriteIsSandboxed, extensionGrantsPath } from '../paths.ts';

export const EXTENSION_PERMISSIONS = [
  'ui.components',
  'commands.execute',
  'storage',
  'events',
  'network',
  'notifications',
] as const satisfies readonly ExtensionPermission[];

const permissionSchema = z.enum(EXTENSION_PERMISSIONS);
const grantEntrySchema = z.object({
  grantedPermissions: z.array(permissionSchema).max(32),
}).strict();
const grantFileSchema = z.record(z.string().min(1).max(128), grantEntrySchema).default({});

export type ExtensionGrant = z.infer<typeof grantEntrySchema>;

export type ExtensionGrantStore = {
  readonly available: boolean;
  readonly grants: ReadonlyMap<string, readonly ExtensionPermission[]>;
};

const emptyStore = (available: boolean): ExtensionGrantStore => ({
  available,
  grants: new Map(),
});

/** Read grants fail closed. A missing optional file is the same as an empty policy. */
export async function loadExtensionGrants(path = extensionGrantsPath()): Promise<ExtensionGrantStore> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore(true);
    return emptyStore(false);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore(false);
  }
  const result = grantFileSchema.safeParse(parsed);
  if (!result.success) return emptyStore(false);

  const grants = new Map<string, readonly ExtensionPermission[]>();
  for (const [id, entry] of Object.entries(result.data)) {
    grants.set(id, Object.freeze([...entry.grantedPermissions]));
  }
  return { available: true, grants };
}

/** Return only the permissions requested by the current manifest and covered by policy. */
export function effectiveGrantedPermissions(
  store: ExtensionGrantStore,
  id: string,
  requested: readonly ExtensionPermission[],
): readonly ExtensionPermission[] {
  const granted = new Set(store.grants.get(id) ?? []);
  return Object.freeze(requested.filter((permission) => granted.has(permission)));
}

export type WriteGrantResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Approve exactly the current request or remove the policy. The caller cannot write an arbitrary
 * permission set, which keeps the grant file a user policy rather than a second manifest.
 */
export async function writeExtensionGrant(
  id: string,
  requested: readonly ExtensionPermission[],
  approved: boolean,
  path = extensionGrantsPath(),
): Promise<WriteGrantResult> {
  const current = await loadExtensionGrants(path);
  if (!current.available && current.grants.size === 0) {
    // A missing file is available; this branch is corrupt, unreadable or otherwise unavailable.
    try {
      await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Continue: the first approval creates the optional file.
      } else {
        return { ok: false, error: 'the extension permission file cannot be read' };
      }
    }
  }

  const next: Record<string, ExtensionGrant> = {};
  for (const [key, permissions] of current.grants) {
    next[key] = { grantedPermissions: [...permissions] as ExtensionPermission[] };
  }
  if (approved) next[id] = { grantedPermissions: [...requested] as ExtensionPermission[] };
  else delete next[id];

  const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    assertCezarHomeWriteIsSandboxed(path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    return { ok: true };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'the extension permission file cannot be written' };
  }
}
