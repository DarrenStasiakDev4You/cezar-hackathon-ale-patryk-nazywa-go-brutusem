import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  LAYOUT_SCHEMA_VERSION,
  LayoutSchemaError,
  parseLayoutJson,
  parseLayoutSchema,
  serializeLayoutSchema,
  type IsJson,
  type LayoutSchema,
} from '@open-mercato/cezar-extension-api'

const HEADER = { id: 'header', contract: 'cezar.task.header.main', contractVersion: 1 } as const
const COMPOSER = {
  id: 'composer',
  contract: 'cezar.task.composer',
  contractVersion: 1,
  layout: { collapsed: false, density: 'compact', width: 'large' },
} as const

const VALID: LayoutSchema = {
  page: 'task',
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  zones: {
    header: [HEADER],
    main: [COMPOSER],
    sidebar: [],
  },
}

describe('LayoutSchema', () => {
  it('is a JSON-only public model', () => {
    expectTypeOf<IsJson<LayoutSchema>>().toEqualTypeOf<true>()
  })

  it('exports a v1 model and preserves zone and placement order through JSON', () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(1)
    const encoded = serializeLayoutSchema(VALID)
    expect(encoded).toBe(
      '{"page":"task","schemaVersion":1,"zones":{"header":[{"id":"header","contract":"cezar.task.header.main","contractVersion":1}],"main":[{"id":"composer","contract":"cezar.task.composer","contractVersion":1,"layout":{"collapsed":false,"density":"compact","width":"large"}}],"sidebar":[]}}',
    )
    expect(parseLayoutJson(encoded)).toEqual(VALID)
  })

  it.each([
    ['root', null, 'must be an object'],
    ['page', { ...VALID, page: '  ' }, 'page must be a non-empty string'],
    ['missing version', { ...VALID, schemaVersion: undefined }, 'schemaVersion must be the supported layout schema version 1'],
    ['version', { ...VALID, schemaVersion: 2 }, 'schemaVersion unsupported layout schema version 2'],
    ['zones', { ...VALID, zones: [] }, 'zones must be an object of named placement arrays'],
    ['zone name', { ...VALID, zones: { '  ': [] } }, 'zones.   must be a non-empty string'],
    ['placement id', { ...VALID, zones: { main: [{ ...COMPOSER, id: '' }] } }, 'zones.main[0].id must be a non-empty string'],
    ['contract version', { ...VALID, zones: { main: [{ ...COMPOSER, contractVersion: 0 }] } }, 'zones.main[0].contractVersion must be a positive integer'],
    ['layout value', { ...VALID, zones: { main: [{ ...COMPOSER, layout: { width: 'huge' } }] } }, 'zones.main[0].layout.width must be `auto`, `small`, `medium` or `large`'],
    ['unknown placement field', { ...VALID, zones: { main: [{ ...COMPOSER, props: {} }] } }, 'zones.main[0].props is not supported in layout schema version 1'],
  ] as const)('rejects invalid %s values with a path', (_name, value, message) => {
    expect(() => parseLayoutSchema(value)).toThrow(message)
    try {
      parseLayoutSchema(value)
    } catch (error) {
      expect(error).toBeInstanceOf(LayoutSchemaError)
      if (message === 'must be an object') expect((error as LayoutSchemaError).issues[0]?.path).toBe('')
      else expect((error as LayoutSchemaError).issues[0]?.path).toContain(message.split(' ')[0])
    }
  })

  it('rejects duplicate placement ids across zones atomically', () => {
    expect(() => parseLayoutSchema({
      ...VALID,
      zones: {
        header: [{ id: 'same', contract: 'cezar.one', contractVersion: 1 }],
        main: [{ id: 'same', contract: 'cezar.two', contractVersion: 1 }],
      },
    })).toThrow('zones.main[0].id must be unique')
  })

  it('distinguishes malformed JSON from an invalid schema', () => {
    expect(() => parseLayoutJson('{')).toThrowError(expect.objectContaining({ code: 'invalid-json' }))
    expect(() => parseLayoutJson(JSON.stringify({ ...VALID, schemaVersion: 9 }))).toThrowError(
      expect.objectContaining({ code: 'unsupported-version' }),
    )
    expectTypeOf<LayoutSchemaError['code']>().toEqualTypeOf<'invalid-json' | 'invalid-schema' | 'unsupported-version'>()
  })

  it('rejects runtime and implementation data instead of carrying it through', () => {
    for (const key of ['component', 'implementation', 'props', 'componentSettings']) {
      expect(() => parseLayoutSchema({
        ...VALID,
        zones: { header: [{ ...HEADER, [key]: {} }] },
      })).toThrow(`zones.header[0].${key}`)
    }
  })
})
