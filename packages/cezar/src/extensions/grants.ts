import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertCezarHomeWriteIsSandboxed, extensionGrantsPath } from '../paths.ts';

const permissionName = z.enum([
  'ui.components',
  'commands.execute',
  'storage',
  'events',
  'network',
  'notifications',
]);
const grantEntry = z.object({ grantedPermissions: z.array(permissionName).max(32) }).passthrough();
const grantStore = z.record(z.string().min(1).max(128), grantEntry);

export type ExtensionGrant = z.infer<typeof grantEntry>;
export type ExtensionGrantStore = z.infer<typeof grantStore>;

export interface LoadedExtensionGrants {
  readonly grants: ExtensionGrantStore;
  readonly warning?: string;
}

/** Read grants without allowing one corrupt row to discard every valid approval. */
export async function readExtensionGrants(path = extensionGrantsPath()): Promise<LoadedExtensionGrants> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { grants: {} };
    return { grants: {}, warning: 'the extension grant store could not be read' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { grants: {}, warning: 'the extension grant store contains invalid JSON' };
  }
  const parsed = grantStore.safeParse(value);
  if (parsed.success) return { grants: parsed.data };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { grants: {}, warning: 'the extension grant store has an invalid shape' };
  }
  const salvaged: ExtensionGrantStore = {};
  for (const [id, entry] of Object.entries(value)) {
    const row = grantEntry.safeParse(entry);
    if (row.success) salvaged[id] = row.data;
  }
  return { grants: salvaged, warning: 'some extension grants were invalid and were ignored' };
}

export function grantedPermissionsFor(
  grants: ExtensionGrantStore,
  id: string,
  requested: readonly string[],
): readonly string[] {
  const stored = new Set<string>(grants[id]?.grantedPermissions ?? []);
  return Object.freeze(requested.filter((permission) => stored.has(permission)));
}

export function permissionsCovered(requested: readonly string[], granted: readonly string[]): boolean {
  return requested.every((permission) => granted.includes(permission));
}

/** Atomic read-modify-write. The temp file is in the same directory so rename is atomic. */
export async function writeExtensionGrant(
  id: string,
  requestedPermissions: readonly string[],
  approved: boolean,
  path = extensionGrantsPath(),
): Promise<void> {
  const loaded = await readExtensionGrants(path);
  const next: ExtensionGrantStore = { ...loaded.grants };
  if (!approved) delete next[id];
  else {
    const requested = permissionName.array().safeParse(requestedPermissions);
    if (!requested.success) throw new Error('the extension requested an unsupported permission');
    next[id] = { grantedPermissions: [...new Set(requested.data)] };
  }
  await mkdir(dirname(path), { recursive: true });
  assertCezarHomeWriteIsSandboxed(path);
  const temporary = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await import('node:fs/promises').then(({ unlink }) => unlink(temporary).catch(() => {}));
    throw new Error('the extension grant could not be saved', { cause: error });
  }
}
