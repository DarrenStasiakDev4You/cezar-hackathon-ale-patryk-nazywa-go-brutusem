import { describe, expect, it } from 'vitest'

import {
  LAYOUT_SCHEMA_VERSION,
  parseLayoutJson,
  serializeLayoutSchema,
  TaskComposer,
  TaskHeaderMain,
} from '@open-mercato/cezar-extension-api'

import { defaultTaskPageLayout, defaultTaskPageLayoutV3, loadTaskPageLayout } from './task-layout-schema'

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
})
