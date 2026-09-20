import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskMetadataProps } from '@open-mercato/cezar-extension-api'

import { CoreTaskMetadata } from './core-task-metadata'

afterEach(cleanup)

const props = (): TaskMetadataProps => ({
  task: { id: 'r1', projectId: 'acme', title: 'Do the thing' },
  metadata: {
    workflow: 'quick-task',
    branch: 'cez/r1',
    diff: { added: 2, removed: 1, files: 1 },
    engine: { runner: 'claude', model: 'auto' },
  },
  actions: {
    resolveConflicts: { available: false, enabled: false, pending: false },
    chooseEngine: { available: false, enabled: false, pending: false },
  },
  intents: { resolveConflicts: vi.fn(), navigate: vi.fn(), chooseEngine: vi.fn() },
})

describe('CoreTaskMetadata', () => {
  it('renders from contract props alone and owns no outer spacing', () => {
    render(<CoreTaskMetadata {...props()} />)

    const row = document.querySelector<HTMLElement>('[data-slot="run-meta"]')
    if (row === null) throw new Error('metadata row missing')
    expect(row.textContent).toContain('quick-task')
    expect(row.textContent).toContain('cez/r1')
    expect(row.className).not.toContain('mt-')
  })
})
