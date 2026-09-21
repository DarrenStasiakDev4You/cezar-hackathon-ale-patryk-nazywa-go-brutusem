import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { createApp } from './server.ts';
import { apiRequest } from './loopback-request.testkit.ts';

const originalHome = process.env.CEZ_HOME;
const originalRemote = process.env.CEZ_REMOTE;
const roots: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.CEZ_HOME;
  else process.env.CEZ_HOME = originalHome;
  if (originalRemote === undefined) delete process.env.CEZ_REMOTE;
  else process.env.CEZ_REMOTE = originalRemote;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function manifest(id: string, permissions: string[] = []): string {
  return JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    engines: { cezar: '^0.11.0' },
    permissions,
    cezar: { apiVersion: 1 },
    entrypoints: { frontend: './dist/frontend.js' },
  });
}

function appFor(repoRoot: string) {
  const store = RunStore.open(join(repoRoot, '.ai/cezar'));
  return createApp({ repoRoot, store, manager: {} as RunManager, version: '0.11.1' });
}

describe('local extension HTTP surface', () => {
  let home: string;
  let repoRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cez-extension-api-home-'));
    repoRoot = mkdtempSync(join(tmpdir(), 'cez-extension-api-repo-'));
    roots.push(home, repoRoot);
    process.env.CEZ_HOME = home;
    mkdirSync(join(repoRoot, '.ai/cezar'), { recursive: true });
  });

  it('returns an empty local inventory and stable endpoint discovery', async () => {
    const app = appFor(repoRoot);
    const inventory = await apiRequest(app, '/api/v1/extensions');
    expect(inventory.status).toBe(200);
    await expect(inventory.json()).resolves.toMatchObject({ available: true, directory: '~/.cezar/extensions', extensions: [] });
    const endpoints = await apiRequest(app, '/api/v1/extensions/endpoints');
    expect(await endpoints.json()).toEqual({
      available: true,
      apiVersion: '1',
      endpoints: {
        inventory: '/api/v1/extensions',
        diagnostics: '/api/v1/extensions/diagnostics',
        approval: '/api/v1/extensions/:id/approval',
        assets: '/api/v1/extensions/:id/assets/*path',
      },
    });
  });

  it('serves only an admitted JavaScript asset and approves requested permissions explicitly', async () => {
    const packageRoot = join(home, 'extensions', 'demo');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    writeFileSync(join(packageRoot, 'cezar.extension.json'), manifest('acme.demo', ['events']));
    writeFileSync(join(packageRoot, 'dist/frontend.js'), 'export default { manifest: { id: "acme.demo" } };');
    const app = appFor(repoRoot);

    const before = await apiRequest(app, '/api/v1/extensions');
    const beforeBody = await before.json() as { extensions: Array<Record<string, unknown>> };
    expect(beforeBody.extensions[0]).toMatchObject({ status: 'permission-required', frontendUrl: null });
    const approval = await apiRequest(app, '/api/v1/extensions/acme.demo/approval', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    expect(approval.status).toBe(200);
    const after = await approval.json() as { extensions: Array<Record<string, unknown>> };
    expect(after.extensions[0]).toMatchObject({ status: 'ready' });
    const frontendUrl = after.extensions[0]?.frontendUrl;
    expect(frontendUrl).toEqual(expect.any(String));
    const asset = await apiRequest(app, frontendUrl as string);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
    expect(asset.headers.get('access-control-allow-origin')).toBeNull();
    expect(await asset.text()).toContain('acme.demo');
    expect((await apiRequest(app, '/api/v1/extensions/acme.demo/assets/dist/frontend.css')).status).toBe(404);
  });

  it('does not disclose or serve local packages in hosted mode', async () => {
    process.env.CEZ_REMOTE = '1';
    const app = appFor(repoRoot);
    const inventory = await apiRequest(app, '/api/v1/extensions');
    expect(await inventory.json()).toEqual({ available: false, reason: 'hosted-mode', extensions: [], diagnostics: [], canApprove: false });
    const approval = await apiRequest(app, '/api/v1/extensions/acme.demo/approval', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    expect(approval.status).toBe(409);
  });
});
