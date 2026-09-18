import { describe, expect, it, vi } from 'vitest'

import type { Extension, ExtensionManifest } from '@open-mercato/cezar-extension-api'
import { fixture, fixtureManifest } from './registry.fixtures'
import { createExtensionRegistry, ExtensionRegistryError, type ExtensionRegistryOptions } from './registry'

const noServices: ExtensionRegistryOptions['services'] = () => {
  throw new Error('no services in this test')
}

function registryError(run: () => unknown): ExtensionRegistryError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ExtensionRegistryError)
    return error as ExtensionRegistryError
  }
  throw new Error('expected an ExtensionRegistryError')
}

describe('register', () => {
  it('records a valid extension as registered, and `{ enabled: false }` as disabled', () => {
    const registry = createExtensionRegistry({ services: noServices })

    const a = registry.register(fixture('acme.alpha'))
    const b = registry.register(fixture('acme.beta'), { enabled: false })

    expect(a).toEqual({ id: 'acme.alpha', manifest: fixtureManifest('acme.alpha'), status: 'registered' })
    expect(b.status).toBe('disabled')
    expect(a).not.toHaveProperty('error')
    expect(registry.get('acme.alpha')).toBe(a)
    expect(registry.get('acme.beta')).toBe(b)
    expect(registry.get('acme.nobody')).toBeUndefined()
  })

  it('refuses a duplicate id and leaves the first record untouched', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const first = registry.register(fixture('acme.alpha'))

    const error = registryError(() => registry.register(fixture('acme.alpha')))

    expect(error.code).toBe('duplicate-extension')
    expect(error.name).toBe('ExtensionRegistryError')
    expect(error.message).toContain('acme.alpha')
    expect(registry.get('acme.alpha')).toBe(first)
    expect(registry.list()).toEqual([first])
  })

  it('refuses an invalid manifest with every issue from defineExtension', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const broken = {
      manifest: { id: 'Not An Id', name: '', version: 'one', engines: { cezar: '^0.11.0' } },
      activate() {},
    } as unknown as Extension

    const error = registryError(() => registry.register(broken))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues.map((issue) => issue.path)).toEqual(['manifest.id', 'manifest.name', 'manifest.version'])
    expect(registry.list()).toEqual([])
  })

  it('refuses an extension without `activate`', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const noActivate = { manifest: fixtureManifest('acme.alpha') } as unknown as Extension

    const error = registryError(() => registry.register(noActivate))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues).toEqual([{ path: 'activate', message: 'must be a function' }])
  })

  it('refuses a value that is not an extension object at all', () => {
    const registry = createExtensionRegistry({ services: noServices })

    const error = registryError(() => registry.register(null as unknown as Extension))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues).toHaveLength(1)
  })

  it('keeps registration order and returns frozen records', () => {
    const registry = createExtensionRegistry({ services: noServices })
    for (const id of ['acme.charlie', 'acme.alpha', 'acme.bravo']) registry.register(fixture(id))

    const records = registry.list()

    expect(records.map((record) => record.id)).toEqual(['acme.charlie', 'acme.alpha', 'acme.bravo'])
    expect(Object.isFrozen(records)).toBe(true)
    for (const record of records) {
      expect(Object.isFrozen(record)).toBe(true)
      expect(Object.isFrozen(record.manifest)).toBe(true)
      expect(Object.isFrozen(record.manifest.engines)).toBe(true)
    }
  })

  it('keeps the manifest captured at registration when the extension reassigns it', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const extension = fixture('acme.alpha')
    registry.register(extension)

    ;(extension as { manifest: ExtensionManifest }).manifest = fixtureManifest('acme.impostor')

    expect(registry.get('acme.alpha')?.manifest.id).toBe('acme.alpha')
    expect(registry.list().map((record) => record.id)).toEqual(['acme.alpha'])
  })

  it('runs no extension code', () => {
    const activate = vi.fn()
    const deactivate = vi.fn()
    const services = vi.fn(noServices)
    const registry = createExtensionRegistry({ services })

    registry.register(fixture('acme.alpha', { activate, deactivate }))

    expect(activate).not.toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    expect(services).not.toHaveBeenCalled()
  })
})
