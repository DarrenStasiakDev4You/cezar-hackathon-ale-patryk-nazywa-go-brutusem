import { describe, expect, it } from 'vitest'

import { TaskComposer, TaskHeaderMain, TaskMetadata } from '@open-mercato/cezar-extension-api'

import {
  createTaskLayoutSnapshot,
  loadTaskLayoutSnapshot,
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

describe('stored Task Page layout boundary', () => {
  const header = { id: 'header-custom', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }
  const composer = { id: 'composer-custom', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true }

  it('renders the default layout when nothing is stored, without calling it a fallback', () => {
    const loaded = loadTaskLayoutSnapshot('run-1')

    expect(loaded.fellBack).toBe(false)
    expect(loaded.snapshot.source).toBe('default')
    expect(loaded.snapshot).toEqual(createTaskLayoutSnapshot({ identity: 'run-1' }))
  })

  it('migrates an older stored document and hands the renderer its placements', () => {
    const loaded = loadTaskLayoutSnapshot('run-1', {
      page: 'task',
      schemaVersion: 2,
      zones: { header: [{ id: 'header-custom', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version }], main: [composer] },
    })

    expect(loaded.load.status).toBe('migrated')
    expect(loaded.fellBack).toBe(false)
    expect(loaded.snapshot.source).toBe('supplied')
    expect(loaded.snapshot.schema.schemaVersion).toBe(1)
    expect(loaded.snapshot.schema.zones.header?.[0]?.id).toBe('header-custom')
    expect(loaded.snapshot.schema.zones.main?.[0]).toEqual({ id: 'composer-custom', contract: TaskComposer.id, contractVersion: TaskComposer.version })
  })

  it('renders the default layout when the loader rejects the stored document', () => {
    const loaded = loadTaskLayoutSnapshot('run-1', { page: 'task', schemaVersion: 3, zones: { header: [header] } })

    expect(loaded.load.status).toBe('fallback')
    expect(loaded.fellBack).toBe(true)
    expect(loaded.snapshot.source).toBe('default')
  })

  it('renders the default layout when the renderer rejects a document the loader accepted', () => {
    const stored = { page: 'task', schemaVersion: 3, zones: { header: [header], main: [composer], footer: [] } }
    const loaded = loadTaskLayoutSnapshot('run-1', stored)

    expect(loaded.load.status).toBe('current')
    expect(loaded.fellBack).toBe(true)
    expect(loaded.snapshot.source).toBe('default')
    expect(loaded.snapshot.diagnostics).toEqual([{ code: 'unknown-zone', schemaZone: 'footer' }])
    expect(stored.zones.footer).toEqual([])
  })

  it('treats a main zone of task metadata alone as a missing composer', () => {
    const loaded = loadTaskLayoutSnapshot('run-1', {
      page: 'task',
      schemaVersion: 3,
      zones: { header: [header], main: [{ id: 'metadata', contract: TaskMetadata.id, contractVersion: TaskMetadata.version, required: false }] },
    })

    expect(loaded.fellBack).toBe(true)
    expect(loaded.load.status === 'fallback' ? loaded.load.error.code : undefined).toBe('missing-required-placement')
  })
})
