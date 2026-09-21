import { describe, expect, it } from 'vitest'

import {
  LAYOUT_SCHEMA_VERSION,
  parseLayoutJson,
  parseLayoutSchema,
  serializeLayoutSchema,
  TaskComposer,
  TaskHeaderMain,
  TaskMetadata,
} from '@open-mercato/cezar-extension-api'

import { defaultTaskPageLayout, defaultTaskPageLayoutV3, loadTaskPageLayout, toRenderLayoutSchema } from './task-layout-schema'

describe('default Task Page layout schema', () => {
  it('describes only the current contract-backed boundaries', () => {
    expect(defaultTaskPageLayout).toEqual({
      page: 'task',
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      zones: {
        header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version }],
        main: [{ id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version }],
        sidebar: [],
      },
    })
    expect(Object.keys(defaultTaskPageLayout.zones)).toEqual(['header', 'main', 'sidebar'])
  })

  it('is immutable plain data and survives a JSON round trip', () => {
    const header = defaultTaskPageLayout.zones.header!
    expect(Object.isFrozen(defaultTaskPageLayout)).toBe(true)
    expect(Object.isFrozen(defaultTaskPageLayout.zones)).toBe(true)
    expect(Object.isFrozen(header)).toBe(true)
    expect(Object.isFrozen(header[0])).toBe(true)
    expect(JSON.parse(serializeLayoutSchema(defaultTaskPageLayout))).toEqual(defaultTaskPageLayout)
    expect(parseLayoutJson(JSON.stringify(defaultTaskPageLayout))).toEqual(defaultTaskPageLayout)
    expect(serializeLayoutSchema(defaultTaskPageLayout)).not.toMatch(/component|implementation|props|settings/)
  })

  it('maps an incompatible persisted layout to the complete v3 core fallback', () => {
    const result = loadTaskPageLayout({
      page: 'task',
      schemaVersion: 2,
      zones: {
        header: [{ id: 'task-header', contract: 'cezar.old.header', contractVersion: 1, required: true }],
      },
    }, { v2ToV3: { removePlacements: [{ placementId: 'task-header' }] } })

    expect(result.status).toBe('fallback')
    if (result.status === 'fallback') {
      expect(result.fallback).toEqual(defaultTaskPageLayoutV3)
      expect(Object.keys(result.fallback.zones)).toEqual(['header', 'main', 'sidebar'])
      expect(result.original).toEqual(expect.objectContaining({ schemaVersion: 2 }))
    }
  })

  it.each([
    ['header', { main: [{ id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true }] }],
    ['composer', { header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }] }],
    ['wrong zone', { header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }], sidebar: [{ id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true }] }],
  ] as const)('falls back when the v3 document is missing the required %s placement', (_missing, zones) => {
    const result = loadTaskPageLayout({ page: 'task', schemaVersion: 3, zones })

    expect(result.status).toBe('fallback')
    if (result.status === 'fallback') {
      expect(result.error.code).toBe('missing-required-placement')
      expect(result.fallback).toEqual(defaultTaskPageLayoutV3)
    }
  })

  it('accepts the built-in v1 document after migration when required placements are preserved', () => {
    const result = loadTaskPageLayout(defaultTaskPageLayout)

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.schema.schemaVersion).toBe(3)
      expect(result.schema.zones.header?.[0]?.id).toBe('task-header')
      expect(result.schema.zones.main?.[0]?.id).toBe('task-composer')
    }
  })

  it('accepts free-form placement ids: the required role is the contract', () => {
    const result = loadTaskPageLayout({
      page: 'task',
      schemaVersion: 3,
      zones: {
        header: [{ id: 'header-custom', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }],
        main: [{ id: 'composer-custom', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true }],
      },
    })

    expect(result.status).toBe('current')
  })

  it('falls back when the main zone holds task metadata but no composer', () => {
    const result = loadTaskPageLayout({
      page: 'task',
      schemaVersion: 3,
      zones: {
        header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }],
        main: [{ id: 'task-metadata', contract: TaskMetadata.id, contractVersion: TaskMetadata.version, required: false }],
      },
    })

    expect(result.status).toBe('fallback')
    if (result.status === 'fallback') {
      expect(result.error).toEqual(expect.objectContaining({ code: 'missing-required-placement', path: '$.zones.main' }))
    }
  })

  it('projects a migrated document onto the render schema without the required flag', () => {
    const projected = toRenderLayoutSchema({
      page: 'task',
      schemaVersion: 3,
      zones: {
        main: [
          { id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true },
          { id: 'task-metadata', contract: TaskMetadata.id, contractVersion: TaskMetadata.version, required: false, layout: { density: 'compact' } },
        ],
        header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }],
      },
    })

    expect(projected).toEqual({
      page: 'task',
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      zones: {
        main: [
          { id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version },
          { id: 'task-metadata', contract: TaskMetadata.id, contractVersion: TaskMetadata.version, layout: { density: 'compact' } },
        ],
        header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version }],
      },
    })
    expect(Object.keys(projected.zones)).toEqual(['main', 'header'])
    expect(parseLayoutSchema(projected)).toEqual(projected)
    expect(Object.isFrozen(projected.zones.main?.[1])).toBe(true)
  })
})
