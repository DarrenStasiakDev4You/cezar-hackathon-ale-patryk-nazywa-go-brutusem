import { describe, expect, it } from 'vitest'

import { componentSettingsSchema, uiStateSchema, workspaceUiStateSchema } from '@open-mercato/cezar-contract'

describe('component settings contract', () => {
  it('keeps boolean files valid and accepts mixed scalar values in both UI-state shapes', () => {
    const value = {
      'acme.header': { compact: true, density: 'cozy', titleMaxLength: 48 },
    }
    expect(componentSettingsSchema.parse(value)).toEqual(value)
    expect(uiStateSchema.parse({ componentSettings: value }).componentSettings).toEqual(value)
    expect(workspaceUiStateSchema.parse({ componentSettings: value }).componentSettings).toEqual(value)
  })

  it.each([
    ['a 257-character string', { 'acme.header': { title: 'x'.repeat(257) } }],
    ['a 65-field entry', { 'acme.header': Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`field${index}`, true])) }],
    ['a 201-entry map', Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`acme.header${index}`, { enabled: true }]))],
    ['a map larger than 32 KiB', Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`acme.header${index}`, { title: 'x'.repeat(256) }]))],
  ])('rejects %s', (_label, value) => {
    expect(() => componentSettingsSchema.parse(value)).toThrow()
  })

  it('rejects non-finite values', () => {
    expect(() => componentSettingsSchema.parse({ 'acme.header': { count: Number.NaN } })).toThrow()
    expect(() => componentSettingsSchema.parse({ 'acme.header': { count: Number.POSITIVE_INFINITY } })).toThrow()
  })
})
