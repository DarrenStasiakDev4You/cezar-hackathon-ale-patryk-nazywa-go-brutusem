import { describe, expect, expectTypeOf, it } from 'vitest'

import { ExtensionDefinitionError, isExtensionError, type ExtensionErrorCode } from '../src/index.ts'

describe('isExtensionError', () => {
  it('recognises this package’s own definition errors', () => {
    const error = new ExtensionDefinitionError('invalid-id', 'bad id', [])
    expect(isExtensionError(error)).toBe(true)
    expect(isExtensionError(error, 'invalid-id')).toBe(true)
    expect(isExtensionError(error, 'invalid-manifest')).toBe(false)
  })

  it('recognises a plain error carrying a code — as another copy of the package, or the host, raises it', () => {
    const error = Object.assign(new Error('no such command'), { code: 'command-not-found' })
    expect(isExtensionError(error)).toBe(true)
    expect(isExtensionError(error, 'command-not-found')).toBe(true)
    expect(isExtensionError(error, 'disposed')).toBe(false)
  })

  it('recognises an error-shaped object from another realm, where instanceof Error fails', () => {
    expect(isExtensionError({ name: 'Error', message: 'gone', code: 'disposed' }, 'disposed')).toBe(true)
  })

  it.each<ExtensionErrorCode>([
    'invalid-manifest',
    'invalid-id',
    'namespace-violation',
    'duplicate-registration',
    'command-not-found',
    'contract-version-mismatch',
    'storage-quota',
    'disposed',
  ])('knows the %s code', (code) => {
    expect(isExtensionError(Object.assign(new Error(code), { code }), code)).toBe(true)
  })

  it('rejects other errors, unknown codes and non-errors', () => {
    expect(isExtensionError(new Error('plain'))).toBe(false)
    expect(isExtensionError(Object.assign(new Error('fs'), { code: 'ENOENT' }))).toBe(false)
    expect(isExtensionError({ code: 'disposed' })).toBe(false)
    expect(isExtensionError('disposed')).toBe(false)
    expect(isExtensionError(null)).toBe(false)
    expect(isExtensionError(undefined)).toBe(false)
  })

  it('narrows to an Error with a typed code', () => {
    const error: unknown = Object.assign(new Error('x'), { code: 'disposed' })
    if (isExtensionError(error)) {
      expectTypeOf(error.code).toEqualTypeOf<ExtensionErrorCode>()
      expectTypeOf(error.message).toEqualTypeOf<string>()
    }
  })
})
