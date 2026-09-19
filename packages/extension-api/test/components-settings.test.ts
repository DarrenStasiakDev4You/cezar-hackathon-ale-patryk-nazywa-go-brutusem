import { describe, expect, it } from 'vitest'
import { booleanSetting, defineSettings, ExtensionDefinitionError } from '../src/index.ts'

describe('component settings', () => {
  it('derives defaults and resolves sparse values', () => {
    const definition = defineSettings({ scope: 'global', schema: { compact: booleanSetting({ default: false }), visible: booleanSetting({ default: true }) } })
    expect(definition.defaults).toEqual({ compact: false, visible: true })
    expect(definition.parse({ compact: true })).toEqual({ compact: true, visible: true })
    expect(Object.isFrozen(definition.parse({}))).toBe(true)
  })
  it('rejects unknown and malformed values', () => {
    const definition = defineSettings({ scope: 'project', schema: { compact: booleanSetting({ default: false }) } })
    expect(() => definition.parse({ other: true })).toThrow('unknown component setting')
    expect(() => definition.parse({ compact: 'yes' })).toThrow('must be a boolean')
    expect(() => booleanSetting({ default: 'yes' as never })).toThrow(ExtensionDefinitionError)
  })
})
