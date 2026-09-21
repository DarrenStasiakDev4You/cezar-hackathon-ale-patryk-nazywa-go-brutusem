import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarketplaceCatalogResponse, MarketplaceExtension } from '@open-mercato/cezar-contract';
import { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import { createApp } from './server.ts';

const extension = {
  id: 'acme.jira',
  name: 'Jira Integration',
  description: 'Issues and transitions on the task header.',
  publisher: { id: 'acme', name: 'ACME Corp' },
  repository: 'https://github.com/acme/cezar-jira',
  versions: [{
    version: '1.3.0',
    compatibility: { apiVersion: 1, cezar: '^0.12.0' },
    permissions: ['ui.components', 'events'],
    releaseUrl: 'https://github.com/acme/cezar-jira/releases/download/v1.3.0/acme.jira.tgz',
    checksum: { algorithm: 'sha256' as const, value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
  }],
} satisfies MarketplaceExtension;

describe('marketplace workspace route', () => {
  let repoRoot: string | undefined;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  });

  function appWith(read: () => Promise<MarketplaceCatalogResponse>) {
    repoRoot = mkdtempSync(join(tmpdir(), 'cez-marketplace-api-'));
    const store = RunStore.open(join(repoRoot, '.ai/cezar'));
    return createApp({
      repoRoot,
      store,
      manager: {} as RunManager,
      version: '0.0.0-test',
      marketplace: { read },
    });
  }

  it('is on-demand, returns the service result, and is not project-scoped', async () => {
    let reads = 0;
    const body: MarketplaceCatalogResponse = {
      available: true,
      source: 'https://registry.example.invalid/cezar/extensions.json',
      fetchedAt: '2026-09-20T09:00:02.000Z',
      partial: false,
      extensions: [extension],
    };
    const app = appWith(async () => {
      reads += 1;
      return body;
    });
    expect(reads).toBe(0);
    const response = await apiRequest(app, '/api/v1/extensions/marketplace');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(reads).toBe(1);
    expect((await apiRequest(app, '/api/v1/p/default/extensions/marketplace')).status).toBe(404);
    expect(app.routes.some((route) => route.path.includes('/p/:projectId/extensions/marketplace'))).toBe(false);
  });

  it('keeps an unavailable registry a successful optional API response', async () => {
    const app = appWith(async () => ({
      available: false,
      reason: 'marketplace registry is unavailable',
    }));
    const response = await apiRequest(app, '/api/v1/extensions/marketplace');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      reason: 'marketplace registry is unavailable',
    });
  });
});
