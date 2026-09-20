import { describe, expect, it } from 'vitest'

import { parseLayoutJson, parseLayoutSchema, serializeLayoutSchema, tryParseLayoutSchema } from './layout-schema'

const v1 = {
  page: 'task',
  schemaVersion: 1 as const,
  zones: {
    header: [{ id: 'header', contract: 'cezar.task.header', contractVersion: 1 }],
    main: [],
  },
}

const v2 = {
  page: 'task',
  schemaVersion: 2 as const,
  zones: {
    top: [{ id: 'header', contract: 'cezar.task.header', contractVersion: 1, required: true }],
  },
}

const v3 = {
  page: 'task',
  schemaVersion: 3 as const,
  zones: {
    top: [{ id: 'header', contract: 'cezar.task.header', contractVersion: 1, required: true }],
  },
}

describe('versioned layout schema parser', () => {
  it.each([v1, v2, v3])('parses and serializes v$schemaVersion as plain JSON', (schema) => {
    const parsed = parseLayoutSchema(schema)
    expect(JSON.parse(serializeLayoutSchema(parsed))).toEqual(schema)
  })

  it('preserves zone and placement order', () => {
    const schema = parseLayoutJson(JSON.stringify({
      page: 'task',
      schemaVersion: 3,
      zones: {
        sidebar: [
          { id: 'first', contract: 'cezar.first', contractVersion: 1, required: false },
          { id: 'second', contract: 'cezar.second', contractVersion: 1, required: true },
        ],
      },
    }))
    expect(Object.keys(schema.zones)).toEqual(['sidebar'])
    expect(schema.zones.sidebar!.map((placement) => placement.id)).toEqual(['first', 'second'])
  })

  it('rejects duplicate ids, unknown versions and runtime-shaped fields', () => {
    const duplicate = tryParseLayoutSchema({
      ...v2,
      zones: { top: [v2.zones.top[0], { ...v2.zones.top[0], id: 'header' }] },
    })
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) expect(duplicate.error.path).toBe('$.zones.top[1].id')

    const unknown = tryParseLayoutSchema({ ...v1, schemaVersion: 9 })
    expect(unknown.success).toBe(false)
    if (!unknown.success) expect(unknown.error.code).toBe('unsupported-version')

    const runtime = tryParseLayoutSchema({ ...v1, runtime: { render: () => null } })
    expect(runtime.success).toBe(false)
  })

  it('requires v3 required flags and keeps malformed JSON distinct', () => {
    const missingRequired = tryParseLayoutSchema({ ...v3, zones: { top: [{ ...v3.zones.top[0], required: undefined }] } })
    expect(missingRequired.success).toBe(false)
    if (!missingRequired.success) expect(missingRequired.error.path).toBe('$.zones.top[0].required')
    const malformed = tryParseLayoutSchema('{')
    expect(malformed.success).toBe(false)
    if (!malformed.success) expect(malformed.error.code).toBe('invalid-schema')
    expect(() => parseLayoutJson('{')).toThrow('not valid JSON')
  })
})
