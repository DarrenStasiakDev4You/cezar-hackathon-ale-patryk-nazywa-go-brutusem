import { describe, expect, it } from 'vitest'

import { TaskComposer, TaskHeaderMain, TaskMetadata } from '@open-mercato/cezar-extension-api'

import {
  createTaskLayoutSnapshot,
  replaceTaskLayout,
  replaceTaskLayoutInput,
  validateTaskLayout,
} from './task-layout'

describe('Task Page layout lifecycle', () => {
  it('starts from the immutable default and applies a complete valid replacement', () => {
    const initial = createTaskLayoutSnapshot({ identity: 'run-1' })
    const candidate = {
      page: 'task' as const,
      schemaVersion: 1 as const,
      zones: {
        main: [{ id: 'composer-first', contract: TaskComposer.id, contractVersion: TaskComposer.version }],
        header: [{ id: 'header-second', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version }],
        sidebar: [],
      },
    }

    const result = replaceTaskLayout(initial, candidate)
    expect(result.applied).toBe(true)
    expect(result.snapshot.source).toBe('supplied')
    expect(Object.keys(result.snapshot.schema.zones)).toEqual(['main', 'header', 'sidebar'])
    expect(result.snapshot.diagnostics).toEqual([])
  })

  it('retains the last valid snapshot and reports malformed raw input', () => {
    const initial = createTaskLayoutSnapshot({ identity: 'run-1' })
    const result = replaceTaskLayoutInput(initial, '{not json')

    expect(result.applied).toBe(false)
    expect(result.snapshot.schema).toBe(initial.schema)
    expect(result.snapshot.source).toBe('default')
    expect(result.snapshot.diagnostics[0]?.code).toBe('invalid-json')
  })

  it('rejects unsupported contracts and required-zone omissions before publication', () => {
    const initial = createTaskLayoutSnapshot({ identity: 'run-1' })
    const candidate = { page: 'task', schemaVersion: 1, zones: { header: [], main: [], sidebar: [] } } as const
    const result = replaceTaskLayout(initial, candidate)

    expect(result.applied).toBe(false)
    expect(result.snapshot.schema).toBe(initial.schema)
    expect(validateTaskLayout(candidate).map((issue) => issue.code)).toEqual(['required-zone-empty', 'required-zone-empty'])
  })

  it('distinguishes unsupported schema versions at the raw boundary', () => {
    const initial = createTaskLayoutSnapshot({ identity: 'run-1' })
    const result = replaceTaskLayoutInput(initial, { page: 'task', schemaVersion: 2, zones: {} })

    expect(result.applied).toBe(false)
    expect(result.snapshot.diagnostics[0]?.code).toBe('unsupported-version')
  })

  it('admits placements through the shared page admission, including contract zone policy', () => {
    const header = [{ id: 'header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version }]
    const composer = { id: 'composer', contract: TaskComposer.id, contractVersion: TaskComposer.version }
    const metadata = { id: 'metadata', contract: TaskMetadata.id, contractVersion: TaskMetadata.version }

    expect(validateTaskLayout({ page: 'task', schemaVersion: 1, zones: { header, main: [composer, metadata], sidebar: [] } })).toEqual([])
    expect(validateTaskLayout({ page: 'task', schemaVersion: 1, zones: { header: [metadata], main: [composer], sidebar: [] } })).toEqual([
      { code: 'contract-not-served', schemaZone: 'header', pageZone: 'task.header', placementId: 'metadata', contractId: TaskMetadata.id, contractVersion: TaskMetadata.version },
    ])
  })
})
