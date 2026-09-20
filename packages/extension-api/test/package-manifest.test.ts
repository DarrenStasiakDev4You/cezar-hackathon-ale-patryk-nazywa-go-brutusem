import { describe, expect, it } from 'vitest'

import {
  checkPackageCompatibility,
  EXTENSION_API_VERSION,
  validatePackageManifest,
  type ExtensionPackageManifest,
  type HostIdentity,
  type PackageCompatibility,
} from '../src/package-manifest.ts'

const valid: ExtensionPackageManifest = {
  id: 'acme.jira',
  name: 'Jira Integration',
  version: '1.3.0',
  description: 'Issues and transitions on the task header.',
  author: 'ACME Corp',
  homepage: 'https://acme.example/jira',
  repository: 'https://github.com/acme/cezar-jira',
  cezar: { apiVersion: EXTENSION_API_VERSION },
  engines: { cezar: '^0.12.0' },
  entrypoints: { frontend: './dist/frontend.js' },
  permissions: ['ui.components', 'commands.execute', 'storage', 'network'],
}

const host: HostIdentity = {
  apiVersions: [1],
  release: '0.12.4',
  entrypoints: ['frontend'],
}

function pathsOf(value: unknown): string[] {
  return validatePackageManifest(value).map((issue) => issue.path)
}

describe('validatePackageManifest', () => {
  it('accepts the worked package manifest', () => {
    expect(validatePackageManifest(valid)).toEqual([])
  })

  it('reports all required package fields on an empty document', () => {
    expect(pathsOf({})).toEqual(['id', 'name', 'version', 'engines', 'cezar.apiVersion', 'entrypoints.frontend'])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1'])('rejects an invalid API generation: %s', (apiVersion) => {
    expect(pathsOf({ ...valid, cezar: { apiVersion } })).toContain('cezar.apiVersion')
  })

  it('requires a frontend entrypoint and validates a reserved backend path', () => {
    expect(pathsOf({ ...valid, entrypoints: {} })).toContain('entrypoints.frontend')
    expect(validatePackageManifest({ ...valid, entrypoints: { frontend: './dist/frontend.mjs', backend: './dist/backend.js' } })).toEqual([])
  })

  it.each([
    '../../etc/passwd',
    './a/../b.js',
    '/abs/x.js',
    'x.js',
    'https://cdn.example/x.js',
    './a//b.js',
    './a/b.txt',
    './a:b.js',
    './a\\b.js',
  ])('rejects an unsafe entrypoint path: %s', (frontend) => {
    expect(pathsOf({ ...valid, entrypoints: { frontend } })).toContain('entrypoints.frontend')
  })

  it('rejects strict-section typos but keeps top-level metadata forward-compatible', () => {
    const typo = {
      ...valid,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      contributes: { commands: [] },
      cezar: { apiVersion: 1, allowPrerelease: true },
      entrypoints: { fronted: './index.js', frontend: './dist/frontend.js' },
    }
    expect(pathsOf(typo)).toEqual(['cezar.allowPrerelease', 'entrypoints.fronted'])
    expect(validatePackageManifest({ ...valid, cezar: { apiVersion: 2, allowPrerelease: true } })).toEqual([])
  })

  it('rejects permissions not defined by this generation', () => {
    expect(validatePackageManifest({ ...valid, permissions: ['ui.componets'] })).toEqual([
      { path: 'permissions[0]', message: 'must be a permission supported by this API generation' },
    ])
  })

  it('requires optional metadata to be absolute https URLs', () => {
    expect(pathsOf({ ...valid, homepage: 'http://acme.example' })).toContain('homepage')
    expect(pathsOf({ ...valid, repository: 'https://' })).toContain('repository')
    expect(pathsOf({ ...valid, homepage: `https://acme.example/${'x'.repeat(2041)}` })).toContain('homepage')
  })

  it('treats a JSON __proto__ member as an unknown strict-section key', () => {
    const value = JSON.parse(JSON.stringify(valid)) as { cezar: Record<string, unknown> }
    Object.defineProperty(value.cezar, '__proto__', { value: { allow: true }, enumerable: true })
    expect(pathsOf(value)).toContain('cezar.__proto__')
  })

  it('never throws for an unreadable object', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom') } })
    expect(() => validatePackageManifest(hostile)).not.toThrow()
    expect(pathsOf(hostile)).toEqual([''])
  })
})

describe('checkPackageCompatibility', () => {
  it('accepts a compatible package and freezes the complete result', () => {
    const outcome = checkPackageCompatibility(valid, host)
    expect(outcome).toEqual({ compatible: true, issues: [] })
    expect(Object.isFrozen(outcome)).toBe(true)
    expect(Object.isFrozen(outcome.issues)).toBe(true)
  })

  it('stops at malformed manifests before comparing versions or entrypoints', () => {
    const outcome = checkPackageCompatibility({}, host)
    expect(outcome.compatible).toBe(false)
    expect(outcome.issues.every((issue) => issue.code === 'malformed')).toBe(true)
  })

  it('refuses an unsupported API generation before checking the release range', () => {
    const outcome = checkPackageCompatibility({ ...valid, cezar: { apiVersion: 2 }, engines: { cezar: 'not-a-range' } }, host)
    expect(outcome.issues).toEqual([{
      code: 'unsupported-api-version',
      message: 'extension API version 2 is not supported; this Cezar supports 1',
      expected: [1],
      actual: 2,
    }])
  })

  it('refuses an unsupported range before comparing the host release', () => {
    const outcome = checkPackageCompatibility({ ...valid, engines: { cezar: '0.12.0 - 0.14.0' } }, host)
    expect(outcome.issues[0]?.code).toBe('unsupported-range')
  })

  it('refuses a host release outside the declared range, including a prerelease opt-in', () => {
    expect(checkPackageCompatibility(valid, { ...host, release: '0.13.0' }).issues[0]?.code).toBe('release-out-of-range')
    expect(checkPackageCompatibility(valid, { ...host, release: '0.12.0-rc.1' }).issues[0]?.code).toBe('release-out-of-range')
    expect(checkPackageCompatibility(
      { ...valid, engines: { cezar: '>=0.12.0-rc.1 <0.13.0' } },
      { ...host, release: '0.12.0-rc.1' },
    ).compatible).toBe(true)
  })

  it('refuses a valid backend entrypoint on a frontend-only host', () => {
    const outcome = checkPackageCompatibility({ ...valid, entrypoints: { frontend: './dist/frontend.js', backend: './dist/backend.js' } }, host)
    expect(outcome).toEqual({
      compatible: false,
      issues: [{
        code: 'unsupported-entrypoint',
        message: 'backend entrypoint is valid, but this Cezar version does not support backend extensions',
        kind: 'backend',
      }],
    })
  })

  it('allows a host with no supported API versions to load nothing', () => {
    expect(checkPackageCompatibility(valid, { ...host, apiVersions: [] }).issues[0]?.code).toBe('unsupported-api-version')
  })

  it.each([
    { apiVersions: '1', release: '0.12.4', entrypoints: ['frontend'] },
    { apiVersions: [1], release: 'not-semver', entrypoints: ['frontend'] },
    { apiVersions: [1], release: '0.12.4', entrypoints: ['worker'] },
  ])('reports malformed host fields', (invalidHost) => {
    const outcome = checkPackageCompatibility(valid, invalidHost as unknown as HostIdentity)
    expect(outcome.compatible).toBe(false)
    expect(outcome.issues.every((issue) => issue.code === 'malformed')).toBe(true)
  })

  it('never throws for a throwing manifest getter or revoked host proxy', () => {
    const hostileManifest = new Proxy({}, { get() { throw new Error('manifest') } })
    expect(() => checkPackageCompatibility(hostileManifest, host)).not.toThrow()
    const { proxy, revoke } = Proxy.revocable({ ...host }, {})
    revoke()
    expect(() => checkPackageCompatibility(valid, proxy as unknown as HostIdentity)).not.toThrow()
  })

  it('exposes a stable result type', () => {
    const check: PackageCompatibility = checkPackageCompatibility(valid, host)
    expect(check.compatible).toBe(true)
  })
})
