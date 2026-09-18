import { describe, expect, it } from 'vitest'

import { validateManifest, type ExtensionManifest } from '../src/index.ts'

const valid: ExtensionManifest = {
  id: 'acme.tasks',
  name: 'Acme tasks',
  version: '1.4.0',
  description: 'Denser task lists',
  author: 'Acme',
  engines: { cezar: '^0.12.0' },
}

function without(key: keyof ExtensionManifest): Record<string, unknown> {
  const { [key]: _removed, ...rest } = valid
  return rest
}

function pathsOf(value: unknown): string[] {
  return validateManifest(value).map((issue) => issue.path)
}

describe('validateManifest', () => {
  it('returns [] for a valid manifest', () => {
    expect(validateManifest(valid)).toEqual([])
  })

  it('treats description and author as optional', () => {
    expect(validateManifest(without('description'))).toEqual([])
    expect(validateManifest(without('author'))).toEqual([])
  })

  it('ignores unknown keys, so a manifest from a newer Cezar still validates', () => {
    expect(validateManifest({ ...valid, contributes: { commands: [] }, icon: 'x.svg' })).toEqual([])
  })

  it.each([null, undefined, 'acme.tasks', 42, []])('rejects a non-object manifest (%s)', (value) => {
    expect(validateManifest(value)).toEqual([{ path: '', message: 'must be an object' }])
  })

  it('reports every broken rule, not only the first', () => {
    expect(pathsOf({ engines: {} })).toEqual(['id', 'name', 'version', 'engines.cezar'])
  })

  describe('id', () => {
    it('is required and must be a string', () => {
      expect(pathsOf(without('id'))).toEqual(['id'])
      expect(pathsOf({ ...valid, id: 7 })).toEqual(['id'])
    })

    it('must follow the extension id grammar', () => {
      expect(pathsOf({ ...valid, id: 'acme' })).toEqual(['id'])
      expect(pathsOf({ ...valid, id: 'Acme.Tasks' })).toEqual(['id'])
    })

    it('accepts the reserved `cezar` publisher — the host rejects it, not this validator', () => {
      expect(validateManifest({ ...valid, id: 'cezar.tasks' })).toEqual([])
    })
  })

  describe('name', () => {
    it('must be a non-empty string', () => {
      expect(pathsOf(without('name'))).toEqual(['name'])
      expect(pathsOf({ ...valid, name: '' })).toEqual(['name'])
      expect(pathsOf({ ...valid, name: '   ' })).toEqual(['name'])
    })

    it('allows at most 80 characters', () => {
      expect(validateManifest({ ...valid, name: 'n'.repeat(80) })).toEqual([])
      expect(pathsOf({ ...valid, name: 'n'.repeat(81) })).toEqual(['name'])
    })
  })

  describe('version', () => {
    it.each(['0.0.0', '1.4.0', '2.0.0-beta.1', '1.0.0-rc.1+build.5', '10.20.30'])('accepts %s', (version) => {
      expect(validateManifest({ ...valid, version })).toEqual([])
    })

    it.each(['1.4', 'v1.4.0', '01.4.0', '1.4.0-', '1.4.0-01', 'latest', ''])('rejects %s', (version) => {
      expect(pathsOf({ ...valid, version })).toEqual(['version'])
    })

    it('is required', () => {
      expect(pathsOf(without('version'))).toEqual(['version'])
    })
  })

  describe('engines.cezar', () => {
    it('is required', () => {
      expect(pathsOf(without('engines'))).toEqual(['engines'])
      expect(pathsOf({ ...valid, engines: 'cezar@^0.12.0' })).toEqual(['engines'])
      expect(pathsOf({ ...valid, engines: {} })).toEqual(['engines.cezar'])
    })

    it('must be a non-empty string of at most 64 characters — the range semantics are the host’s', () => {
      expect(validateManifest({ ...valid, engines: { cezar: '>=0.11.1 <0.13.0 || ^1.0.0' } })).toEqual([])
      expect(pathsOf({ ...valid, engines: { cezar: '' } })).toEqual(['engines.cezar'])
      expect(pathsOf({ ...valid, engines: { cezar: 12 } })).toEqual(['engines.cezar'])
      expect(pathsOf({ ...valid, engines: { cezar: 'x'.repeat(65) } })).toEqual(['engines.cezar'])
    })
  })

  it('requires description and author to be strings when present', () => {
    expect(pathsOf({ ...valid, description: 3, author: ['Acme'] })).toEqual(['description', 'author'])
  })

  it('never throws, even on an unreadable object', () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error('boom')
      },
    })
    expect(() => validateManifest(hostile)).not.toThrow()
    expect(pathsOf(hostile)).toEqual([''])
  })
})
