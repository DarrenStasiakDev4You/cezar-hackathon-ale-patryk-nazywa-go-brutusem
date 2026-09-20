import { describe, expect, it } from 'vitest'

import {
  parseLayoutJson,
  parseLayoutSchema,
  serializeLayoutSchema,
  tryParseLayoutSchema,
} from './layout-schema'

const v1 = {
  page: 'task',
  schemaVersion: 1 as const,
  zones: {
    header: [{ id: 'header', contract: { id: 'cezar.task.header', version: 1 }, component: { id: 'cezar.task.header.default' } }],
    main: [],
  },
}

const v2 = {
  page: 'task',
  schemaVersion: 2 as const,
  zones: {
    top: [{ id: 'header', contract: { id: 'cezar.task.header', version: 1 }, component: { id: 'cezar.task.header.default' }, required: true }],
  },
}

const v3 = {
  page: 'task',
  schemaVersion: 3 as const,
  zones: {
    top: [{ id: 'header', contract: { id: 'cezar.task.header', version: 1 }, component: { id: 'cezar.task.header.default' }, required: true }],
  },
}

describe('LayoutSchema', () => {
  it.each([v1, v2, v3])('parses and serializes schema version $schemaVersion as plain JSON', (schema) => {
    const parsed = parseLayoutSchema(schema)
    expect(JSON.parse(serializeLayoutSchema(parsed))).toEqual(schema)
  })

  it('preserves zone and placement order during round-trip', () => {
    const schema = parseLayoutJson(JSON.stringify({
      page: 'task',
      schemaVersion: 3,
      zones: {
        sidebar: [
          { id: 'first', contract: { id: 'cezar.first', version: 1 }, component: { id: 'cezar.first.default' }, required: false },
          { id: 'second', contract: { id: 'cezar.second', version: 1 }, component: { id: 'cezar.second.default' }, required: true },
        ],
      },
    }))

    expect(Object.keys(schema.zones)).toEqual(['sidebar'])
    expect(schema.zones.sidebar!.map((placement) => placement.id)).toEqual(['first', 'second'])
  })

  it('rejects duplicate placement ids atomically', () => {
    const result = tryParseLayoutSchema({
      ...v1,
      zones: {
        header: v1.zones.header,
        main: [{ ...v1.zones.header[0], id: 'header' }],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.path).toBe('$.zones.main[0].id')
  })

  it('rejects unsupported versions and malformed JSON without guessing', () => {
    const result = tryParseLayoutSchema({ ...v1, schemaVersion: 4 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('unsupported-version')
    expect(() => parseLayoutJson('{')).toThrow('not valid JSON')
  })

  it('requires the required flag in v3', () => {
    const result = tryParseLayoutSchema({
      ...v3,
      zones: { top: [{ ...v3.zones.top[0], required: undefined }] },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.path).toBe('$.zones.top[0].required')
  })

  it('rejects runtime-shaped fields', () => {
    const result = tryParseLayoutSchema({ ...v1, runtime: { render: () => null } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.path).toBe('$.runtime')
  })
})
