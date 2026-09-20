import { describe, expect, it } from 'vitest'
import {
  booleanSetting,
  defineSettings,
  ExtensionDefinitionError,
  numberSetting,
  selectSetting,
  stringSetting,
  type SettingsOf,
} from '../src/index.ts'

describe('component settings', () => {
  it('derives defaults and resolves sparse values', () => {
    const definition = defineSettings({
      scope: 'global',
      schema: {
        compact: booleanSetting({ default: false, label: 'Compact' }),
        title: stringSetting({ default: 'Task', maxLength: 16 }),
        limit: numberSetting({ default: 10, min: 1, max: 20, integer: true }),
        density: selectSetting({ default: 'cozy', options: [{ value: 'compact' }, { value: 'cozy', label: 'Cozy' }] }),
      },
    })
    type Settings = SettingsOf<typeof definition>
    const typed: Settings = { compact: true, title: 'Header', limit: 12, density: 'compact' }
    expect(typed).toEqual({ compact: true, title: 'Header', limit: 12, density: 'compact' })
    expect(definition.defaults).toEqual({ compact: false, title: 'Task', limit: 10, density: 'cozy' })
    expect(definition.parse({ compact: true, title: 'Header', limit: 12 })).toEqual({ compact: true, title: 'Header', limit: 12, density: 'cozy' })
    expect(Object.isFrozen(definition.parse({}))).toBe(true)
  })
  it('rejects unknown and malformed values', () => {
    const definition = defineSettings({ scope: 'project', schema: { compact: booleanSetting({ default: false }) } })
    expect(() => definition.parse({ other: true })).toThrow('unknown component setting')
    expect(() => definition.parse({ compact: 'yes' })).toThrow('must be a boolean')
    expect(() => booleanSetting({ default: 'yes' as never })).toThrow(ExtensionDefinitionError)
    expect(() => selectSetting({ default: 'missing', options: [{ value: 'known' }] })).toThrow('one of its options')
    expect(() => stringSetting({ default: 'long', maxLength: 3 })).toThrow('at most 3')
    expect(() => numberSetting({ default: Number.POSITIVE_INFINITY })).toThrow(ExtensionDefinitionError)
    expect(() => numberSetting({ default: 1.5, integer: true })).toThrow(ExtensionDefinitionError)
  })

  it('parses and validates every supported value type', () => {
    const definition = defineSettings({
      scope: 'project',
      schema: {
        text: stringSetting({ default: '', maxLength: 4 }),
        count: numberSetting({ default: 2, min: 1, max: 5 }),
        choice: selectSetting({ default: 'a', options: [{ value: 'a' }, { value: 'b' }] }),
      },
    })
    expect(definition.parse({ text: 'ok', count: 4, choice: 'b' })).toEqual({ text: 'ok', count: 4, choice: 'b' })
    expect(() => definition.parse({ other: true })).toThrow('unknown component setting "other"')
    expect(() => definition.parse({ text: true })).toThrow('text')
    expect(() => definition.parse({ text: 'longer' })).toThrow('text')
    expect(() => definition.parse({ count: 6 })).toThrow('count')
    expect(() => definition.parse({ choice: 'c' })).toThrow('choice')
  })

  it('keeps the boolean-only API additive', () => {
    const definition = defineSettings({ scope: 'global', schema: { visible: booleanSetting({ default: true }) } })
    expect(definition.parse({})).toEqual({ visible: true })
  })
})
