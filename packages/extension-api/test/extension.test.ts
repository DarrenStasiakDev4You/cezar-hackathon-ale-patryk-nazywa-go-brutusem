import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  defineExtension,
  ExtensionDefinitionError,
  type Extension,
  type ExtensionContext,
  type ExtensionManifest,
} from '../src/index.ts'

const manifest = (): ExtensionManifest => ({
  id: 'acme.tasks',
  name: 'Acme tasks',
  version: '1.0.0',
  engines: { cezar: '^0.12.0' },
})

const typedPermissions: ExtensionManifest = { ...manifest(), permissions: ['storage'] }
// @ts-expect-error Permission names are a closed union for TypeScript authors.
const typoPermission: ExtensionManifest = { ...manifest(), permissions: ['storge'] }
void typedPermissions
void typoPermission

function definitionError(run: () => unknown): ExtensionDefinitionError {
  try {
    run()
  } catch (error) {
    if (error instanceof ExtensionDefinitionError) return error
    throw error
  }
  throw new Error('expected defineExtension to throw')
}

describe('defineExtension', () => {
  it('returns the same object', () => {
    const extension = { manifest: manifest(), activate() {} }
    expect(defineExtension(extension)).toBe(extension)
  })

  it('freezes the manifest, engines included', () => {
    const extension = defineExtension({ manifest: manifest(), activate() {} })
    expect(Object.isFrozen(extension.manifest)).toBe(true)
    expect(Object.isFrozen(extension.manifest.engines)).toBe(true)
  })

  it('freezes manifest permissions', () => {
    const extension = defineExtension({
      manifest: { ...manifest(), permissions: ['storage'] },
      activate() {},
    })
    expect(Object.isFrozen(extension.manifest.permissions)).toBe(true)
  })

  it('accepts an async activate and an optional deactivate', () => {
    expect(() =>
      defineExtension({ manifest: manifest(), async activate() {}, async deactivate() {} }),
    ).not.toThrow()
  })

  it('throws invalid-manifest with every issue, paths relative to the extension', () => {
    const error = definitionError(() =>
      defineExtension({ manifest: { ...manifest(), id: 'Acme', version: '1' }, activate() {} }),
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExtensionDefinitionError')
    expect(error.code).toBe('invalid-manifest')
    expect(error.issues.map((issue) => issue.path)).toEqual(['manifest.id', 'manifest.version'])
    expect(error.message).toContain('"Acme"')
    expect(error.message).toContain('manifest.version must be a semver version')
    expect(Object.isFrozen(error.issues)).toBe(true)
  })

  it('reports an invalid permission with its manifest path', () => {
    const error = definitionError(() =>
      defineExtension({
        manifest: { ...manifest(), permissions: ['Bad.permission'] as never },
        activate() {},
      }),
    )
    expect(error.code).toBe('invalid-manifest')
    expect(error.issues).toEqual([
      {
        path: 'manifest.permissions[0]',
        message:
          'must be one or more dot-separated segments of [a-z][a-z0-9-]*, at most 64 characters',
      },
    ])
  })

  it('throws when activate is not a function', () => {
    const error = definitionError(() =>
      defineExtension({ manifest: manifest(), activate: 'soon' } as unknown as Extension),
    )
    expect(error.issues).toEqual([{ path: 'activate', message: 'must be a function' }])
  })

  it('throws when a present deactivate is not a function', () => {
    const error = definitionError(() =>
      defineExtension({ manifest: manifest(), activate() {}, deactivate: 1 } as unknown as Extension),
    )
    expect(error.issues.map((issue) => issue.path)).toEqual(['deactivate'])
  })

  it('throws on a missing manifest or a non-object extension instead of crashing', () => {
    expect(definitionError(() => defineExtension({ activate() {} } as unknown as Extension)).issues).toEqual([
      { path: 'manifest', message: 'must be an object' },
    ])
    expect(definitionError(() => defineExtension(null as unknown as Extension)).message).toContain('(no id)')
  })

  it('does not freeze anything when it throws', () => {
    const broken = { ...manifest(), name: '' }
    definitionError(() => defineExtension({ manifest: broken, activate() {} }))
    expect(Object.isFrozen(broken)).toBe(false)
  })

  it('types activate’s context without annotations and keeps the literal type', () => {
    const extension = defineExtension({
      manifest: manifest(),
      activate(context) {
        expectTypeOf(context).toEqualTypeOf<ExtensionContext>()
        expectTypeOf(context.notifications.info).toEqualTypeOf<(message: string) => void>()
        expectTypeOf(context.notifications.warning).toEqualTypeOf<(message: string) => void>()
        expectTypeOf(context.notifications.error).toEqualTypeOf<(message: string) => void>()
      },
      extra: 1,
    })
    expectTypeOf(extension.extra).toEqualTypeOf<number>()
  })
})
