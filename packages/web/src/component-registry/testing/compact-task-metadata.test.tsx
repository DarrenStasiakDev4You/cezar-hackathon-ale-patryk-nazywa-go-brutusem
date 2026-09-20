import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(importSites({ path: 'src/component-registry/testing/compact-task-metadata.tsx', source: "import x from '@/private'" })[0]?.specifier).toBe('@/private')
  })

  it('uses core by default, resolves the compact line by preference, and falls back after disposal', async () => {
    const registry = createCoreComponentRegistry()
    const scope = fakeScope('test.compact-task-metadata')
    const handle = registry.forExtension(scope.scope).provide(TaskMetadata, compactTaskMetadata)
    const model = props()

    const view = render(
      <ComponentsProvider registry={registry}>
        <ComponentHost contract={TaskMetadata} subject="r1" props={model} />
      </ComponentsProvider>,
    )

    expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe('cezar.task.metadata.default')

    view.rerender(
      <ComponentsProvider registry={registry} preferenceOf={(id) => (id === TaskMetadata.id ? compactTaskMetadata.id : null)}>
        <ComponentHost contract={TaskMetadata} subject="r1" props={model} />
      </ComponentsProvider>,
    )

    expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe(compactTaskMetadata.id)
    expect(screen.getByText('quick-task · cez/r1 · +2 -1 · claude/auto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose engine' }))
    expect(model.intents.chooseEngine).toHaveBeenCalledOnce()

    handle.dispose()
    await waitFor(() => expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe('cezar.task.metadata.default'))
  })
})
