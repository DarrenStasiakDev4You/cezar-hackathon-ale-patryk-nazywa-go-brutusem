import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskMetadata, type TaskMetadataProps } from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../../extensions/registry.fixtures'
import { importSites } from '../../lib/import-scan'
import { ComponentHost } from '../component-host'
import { createCoreComponentRegistry } from '../core-components'
import { ComponentsProvider } from '../provider'
import { compactTaskMetadata } from './compact-task-metadata'

afterEach(cleanup)

const props = (): TaskMetadataProps => ({
  task: { id: 'r1', projectId: 'p1', title: 'Do the thing' },
  metadata: {
    workflow: 'quick-task',
    branch: 'cez/r1',
    diff: { added: 2, removed: 1, files: 1 },
    engine: { runner: 'claude', model: 'auto' },
  },
  actions: {
    resolveConflicts: { available: false, enabled: false, pending: false },
    chooseEngine: { available: true, enabled: true, pending: false },
  },
  intents: { chooseEngine: vi.fn(), resolveConflicts: vi.fn(), navigate: vi.fn() },
})

describe('compact task metadata implementation', () => {
  it('imports only React and the public extension contract', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'compact-task-metadata.tsx'), 'utf8')
    expect(importSites({ path: 'src/component-registry/testing/compact-task-metadata.tsx', source }).map((site) => site.specifier)).toEqual([
      '@open-mercato/cezar-extension-api',
      'react',
    ])
  })

  it('renders through the generic host and carries the engine intent', () => {
    const registry = createCoreComponentRegistry()
    const scope = fakeScope('test.compact-task-metadata')
    registry.forExtension(scope.scope).provide(TaskMetadata, compactTaskMetadata)
    const model = props()

    render(
      <ComponentsProvider registry={registry} preferenceOf={(id) => (id === TaskMetadata.id ? compactTaskMetadata.id : null)}>
        <ComponentHost contract={TaskMetadata} subject="r1" props={model} />
      </ComponentsProvider>,
    )

    expect(screen.getByText('quick-task · cez/r1 · +2 -1 · claude/auto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose engine' }))
    expect(model.intents.chooseEngine).toHaveBeenCalledOnce()
  })
})
