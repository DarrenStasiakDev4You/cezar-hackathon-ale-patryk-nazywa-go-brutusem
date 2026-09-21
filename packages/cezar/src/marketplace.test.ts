import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_MAX_DOCUMENT_BYTES,
  marketplaceCatalogSchema,
  marketplaceCatalogResponseSchema,
} from '@open-mercato/cezar-contract';
import {
  createMarketplaceRegistry,
  parseMarketplaceCatalog,
  parseMarketplaceCatalogJson,
} from './marketplace.ts';

const checksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function version(version: string, releaseUrl = `https://github.com/acme/example/releases/download/v${version}/extension.tgz`) {
  return {
    version,
    compatibility: { apiVersion: 1, cezar: '^0.12.0' },
    permissions: ['ui.components', 'events'],
    releaseUrl,
    checksum: { algorithm: 'sha256', value: checksum },
  };
}

function extension(id = 'acme.jira', versions = [version('1.3.0')]) {
  return {
    id,
    name: 'Jira Integration',
    description: 'Issues and transitions on the task header.',
    publisher: { id: 'acme', name: 'ACME Corp' },
    repository: 'https://github.com/acme/cezar-jira',
    versions,
  };
}

function catalog(extensions = [extension()]) {
  return { schemaVersion: 1, generatedAt: '2026-09-20T09:00:00.000Z', extensions };
}

describe('marketplace contract and parser', () => {
  it('accepts a release catalog and the exact available response shape', () => {
    const document = catalog();
    expect(marketplaceCatalogSchema.safeParse(document).success).toBe(true);
    expect(marketplaceCatalogResponseSchema.safeParse({
      available: true,
      source: 'https://registry.example.invalid/cezar/extensions.json',
      fetchedAt: '2026-09-20T09:00:02.000Z',
      partial: false,
      extensions: document.extensions,
    }).success).toBe(true);
  });

  it('keeps the checked-in GitHub Release example parseable without fetching it', () => {
    const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/marketplace-catalog.json', import.meta.url), 'utf8')) as unknown;
    expect(parseMarketplaceCatalog(fixture)?.partial).toBe(false);
  });

  it('rejects moving release aliases, uppercase checksums, duplicate permissions and bad ranges', () => {
    expect(marketplaceCatalogSchema.safeParse(catalog([extension('acme.jira', [
      version('1.3.0', 'https://github.com/acme/example/releases/latest/download/extension.tgz'),
    ])])).success).toBe(false);
    expect(marketplaceCatalogSchema.safeParse(catalog([extension('acme.jira', [{
      ...version('1.3.0'),
      compatibility: { apiVersion: 1, cezar: 'not a range' },
    }])])).success).toBe(false);
    expect(marketplaceCatalogSchema.safeParse(catalog([extension('acme.jira', [{
      ...version('1.3.0'),
      permissions: ['events', 'events'],
    }])])).success).toBe(false);
    expect(marketplaceCatalogSchema.safeParse(catalog([extension('acme.jira', [{
      ...version('1.3.0'),
      permissions: ['unknown.permission'],
    }])])).success).toBe(false);
  });

  it('salvages malformed versions and sorts valid versions newest first', () => {
    const result = parseMarketplaceCatalog(catalog([
      extension('acme.jira', [
        version('1.2.0'),
        version('1.4.0-beta.1'),
        { ...version('bad'), version: 'not-semver' },
        version('1.3.0'),
      ]),
    ]));
    expect(result?.partial).toBe(true);
    expect(result?.extensions[0]?.versions.map((item) => item.version)).toEqual([
      '1.4.0-beta.1',
      '1.3.0',
      '1.2.0',
    ]);
  });

  it('omits duplicate extension identities rather than letting document order win', () => {
    const result = parseMarketplaceCatalog(catalog([extension(), extension()]));
    expect(result).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-09-20T09:00:00.000Z',
      extensions: [],
      partial: true,
    });
  });

  it('rejects invalid envelopes, malformed JSON and oversized documents', () => {
    expect(parseMarketplaceCatalog({ schemaVersion: 2, generatedAt: '2026-09-20T09:00:00.000Z', extensions: [] })).toBeNull();
    expect(parseMarketplaceCatalogJson('{not json')).toBeNull();
    expect(parseMarketplaceCatalogJson(' '.repeat(1_000_001))).toBeNull();
  });

  it('fetches on demand, coalesces concurrent reads and reuses only successful results', async () => {
    let calls = 0;
    let now = 1_000;
    const registry = createMarketplaceRegistry({
      now: () => now,
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify(catalog()), { status: 200 });
      },
    });
    const [first, second] = await Promise.all([registry.read(), registry.read()]);
    expect(first).toEqual(second);
    expect(calls).toBe(1);
    now += 1_000;
    await registry.read();
    expect(calls).toBe(1);
  });

  it('fails closed for transport, redirect, malformed and oversized responses', async () => {
    const cases = [
      () => Promise.reject(new Error('offline')),
      async () => new Response('', { status: 302, headers: { location: 'https://evil.example/catalog.json' } }),
      async () => new Response('{not json', { status: 200 }),
      async () => new Response('x'.repeat(MARKETPLACE_MAX_DOCUMENT_BYTES + 1), { status: 200 }),
      async () => new Response('upstream secret body', { status: 500 }),
    ];
    for (const fetch of cases) {
      const response = await createMarketplaceRegistry({ fetch }).read();
      expect(response).toEqual({ available: false, reason: 'marketplace registry is unavailable' });
    }
  });

  it('rejects invalid UTF-8 before replacement characters can enter the catalog', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(catalog()));
    const description = new TextEncoder().encode('Issues and transitions on the task header.');
    const offset = bytes.findIndex((value, index) => value === description[0] && bytes[index + 1] === description[1]);
    expect(offset).toBeGreaterThanOrEqual(0);
    bytes[offset] = 0xc3;
    bytes[offset + 1] = 0x28;
    const response = await createMarketplaceRegistry({
      fetch: async () => new Response(bytes, { status: 200 }),
    }).read();
    expect(response).toEqual({ available: false, reason: 'marketplace registry is unavailable' });
  });

  it('aborts a fetch that exceeds the explicit timeout', async () => {
    const response = await createMarketplaceRegistry({
      timeoutMs: 1,
      fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
      }),
    }).read();
    expect(response).toEqual({ available: false, reason: 'marketplace registry is unavailable' });
  });

  it('returns partial results with a bounded diagnostic and preserves declarations', async () => {
    const diagnostics: string[] = [];
    const response = await createMarketplaceRegistry({
      fetch: async () => new Response(JSON.stringify(catalog([extension('acme.jira', [
        version('1.3.0'),
        { ...version('1.3.1'), compatibility: { apiVersion: 99, cezar: '^9.0.0' } },
        { ...version('invalid'), version: 'not-semver' },
      ])])), { status: 200 }),
      onDiagnostic: (message) => diagnostics.push(message),
    }).read();
    expect(response.available).toBe(true);
    if (response.available) {
      expect(response.partial).toBe(true);
      expect(response.extensions[0]?.versions.find((item) => item.version === '1.3.1')?.compatibility)
        .toEqual({ apiVersion: 99, cezar: '^9.0.0' });
    }
    expect(diagnostics).toEqual(['partial catalog; invalid entries were omitted']);
  });
});
