import { describe, expect, it } from 'vitest'

import {
  LAYOUT_SCHEMA_VERSION,
  parseLayoutJson,
  serializeLayoutSchema,
  TaskComposer,
  TaskHeaderMain,
} from '@open-mercato/cezar-extension-api'

import { defaultTaskPageLayout } from './task-layout-schema'

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
})
