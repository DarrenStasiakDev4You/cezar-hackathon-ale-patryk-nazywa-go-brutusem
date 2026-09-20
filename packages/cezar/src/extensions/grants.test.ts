import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveGrantedPermissions, loadExtensionGrants, writeExtensionGrant } from './grants.ts';

const homes: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'cez-extension-grants-'));
  homes.push(value);
  return value;
}

describe('extension grants', () => {
  it('treats a missing file as an available empty policy', async () => {
    const path = join(await home(), 'extension-grants.json');
    const store = await loadExtensionGrants(path);
    expect(store.available).toBe(true);
    expect(effectiveGrantedPermissions(store, 'acme.demo', ['events'])).toEqual([]);
  });

  it('writes exactly the requested permissions and preserves other ids', async () => {
    const path = join(await home(), 'extension-grants.json');
    expect(await writeExtensionGrant('acme.one', ['events'], true, path)).toEqual({ ok: true });
    expect(await writeExtensionGrant('acme.two', ['storage'], true, path)).toEqual({ ok: true });
    const store = await loadExtensionGrants(path);
    expect(effectiveGrantedPermissions(store, 'acme.one', ['events', 'network'])).toEqual(['events']);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      'acme.one': { grantedPermissions: ['events'] },
      'acme.two': { grantedPermissions: ['storage'] },
    });
  });

  it('keeps a grant across unrelated package changes while requiring expanded requests', async () => {
    const path = join(await home(), 'extension-grants.json');
    await writeExtensionGrant('acme.demo', ['events'], true, path);
    const store = await loadExtensionGrants(path);
    expect(effectiveGrantedPermissions(store, 'acme.demo', ['events'])).toEqual(['events']);
    expect(effectiveGrantedPermissions(store, 'acme.demo', ['events', 'commands.execute'])).toEqual(['events']);
  });

  it('ignores corrupt state and does not partially grant permissions', async () => {
    const path = join(await home(), 'extension-grants.json');
    await writeFile(path, '{not json');
    const store = await loadExtensionGrants(path);
    expect(store.available).toBe(false);
    expect(effectiveGrantedPermissions(store, 'acme.demo', ['events'])).toEqual([]);
  });

  it('reports a failed write instead of pretending a read-only store was saved', async () => {
    const directory = await home();
    const path = join(directory, 'extension-grants.json');
    await writeFile(path, '{}');
    await chmod(path, 0o400);
    const result = await writeExtensionGrant('acme.demo', ['events'], true, path);
    // Root can still write chmod-ed files in some CI containers; either outcome must be valid JSON.
    if (!result.ok) expect(result.error).toContain('permission');
    else expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ 'acme.demo': { grantedPermissions: ['events'] } });
  });
});
