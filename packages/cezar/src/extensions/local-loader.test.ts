import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanLocalExtensions } from './local-loader.ts';

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cez-extension-scan-'));
  roots.push(root);
  return root;
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'acme.demo',
    name: 'Demo',
    version: '1.0.0',
    engines: { cezar: '^0.11.0' },
    cezar: { apiVersion: 1 },
    entrypoints: { frontend: './dist/frontend.js' },
    ...overrides,
  });
}

async function packageAt(root: string, name: string, contents: string, frontend = 'export default {}'): Promise<void> {
  const dir = join(root, name, 'dist');
  await mkdir(dir, { recursive: true });
  await writeFile(join(root, name, 'cezar.extension.json'), contents);
  await writeFile(join(dir, 'frontend.js'), frontend);
}

describe('scanLocalExtensions', () => {
  it('returns an empty available inventory when the directory is missing', async () => {
    const root = join(await fixture(), 'missing');
    const result = await scanLocalExtensions({ root, version: '0.11.1' });
    expect(result.extensions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('validates before exposing a package and keeps broken candidates isolated', async () => {
    const root = await fixture();
    await packageAt(root, 'valid', manifest());
    await packageAt(root, 'broken', '{not json');
    const result = await scanLocalExtensions({ root, version: '0.11.1' });
    expect(result.extensions.find((entry) => entry.candidate === 'valid')).toMatchObject({ status: 'ready', id: 'acme.demo' });
    expect(result.extensions.find((entry) => entry.candidate === 'broken')).toMatchObject({ status: 'rejected' });
  });

  it('requires approval for requested permissions and allows zero-permission packages', async () => {
    const root = await fixture();
    await packageAt(root, 'plain', manifest({ id: 'acme.plain' }));
    await packageAt(root, 'permissioned', manifest({ id: 'acme.permissioned', permissions: ['events'] }));
    const result = await scanLocalExtensions({ root, version: '0.11.1', grantsPath: join(root, 'grants.json') });
    expect(result.extensions.find((entry) => entry.id === 'acme.plain')?.status).toBe('ready');
    expect(result.extensions.find((entry) => entry.id === 'acme.permissioned')).toMatchObject({ status: 'permission-required', diagnostic: { code: 'permission-required' } });
  });

  it('marks every duplicate id and refuses backend-only packages', async () => {
    const root = await fixture();
    await packageAt(root, 'one', manifest());
    await packageAt(root, 'two', manifest());
    await packageAt(root, 'backend', manifest({ id: 'acme.backend', entrypoints: { frontend: './dist/frontend.js', backend: './dist/backend.js' } }));
    const result = await scanLocalExtensions({ root, version: '0.11.1' });
    expect(result.extensions.filter((entry) => entry.status === 'duplicate')).toHaveLength(2);
    expect(result.extensions.find((entry) => entry.id === 'acme.backend')).toMatchObject({ status: 'rejected', diagnostic: { code: 'unsupported-entrypoint' } });
  });

  it('refuses missing and escaping frontend files', async () => {
    const root = await fixture();
    await mkdir(join(root, 'missing'), { recursive: true });
    await writeFile(join(root, 'missing', 'cezar.extension.json'), manifest({ id: 'acme.missing' }));
    const outside = join(root, 'outside.js');
    await writeFile(outside, 'export default {}');
    await packageAt(root, 'escape', manifest({ id: 'acme.escape' }));
    await rm(join(root, 'escape', 'dist', 'frontend.js'));
    await symlink(outside, join(root, 'escape', 'dist', 'frontend.js'));
    const result = await scanLocalExtensions({ root, version: '0.11.1' });
    expect(result.extensions.find((entry) => entry.id === 'acme.missing')).toMatchObject({ status: 'rejected', diagnostic: { code: 'entrypoint-missing' } });
    expect(result.extensions.find((entry) => entry.id === 'acme.escape')).toMatchObject({ status: 'rejected', diagnostic: { code: 'unsafe-path' } });
  });
});
