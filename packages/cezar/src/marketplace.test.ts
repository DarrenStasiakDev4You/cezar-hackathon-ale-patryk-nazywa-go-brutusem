import { describe, expect, it } from 'vitest';
import {
  marketplaceCatalogSchema,
  marketplaceCatalogResponseSchema,
} from '@open-mercato/cezar-contract';
import { parseMarketplaceCatalog, parseMarketplaceCatalogJson } from './marketplace.ts';

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
});
