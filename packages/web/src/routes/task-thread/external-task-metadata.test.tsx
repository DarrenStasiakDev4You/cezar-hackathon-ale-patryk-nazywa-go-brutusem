import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { ComponentsProvider } from '@/component-registry/provider'
import { fakeScope } from '@/extensions/registry.fixtures'
import type { ApiRun, RunStatus } from '@open-mercato/cezar-api-client'
import { TaskMetadata, type ComponentImplementation, type TaskMetadataProps } from '@open-mercato/cezar-extension-api'

import { compactTaskMetadata } from '@/component-registry/testing/compact-task-metadata'

import { reduceThread } from './thread-state'
import { ThreadView } from './task-thread'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const run = (status: RunStatus, extra: Partial<ApiRun> = {}): ApiRun =>
  ({
    id: 'r1',
    title: 'do the thing plz',
    titleSummary: 'Do the thing',
    workflow: 'quick-task',
    task: 'Summarize what this project does.',
    status,
    createdAt: '2026-07-14T12:00:00.000Z',
    branch: 'cez/r1',
    diffStat: { adds: 2, dels: 1, files: 1 },
    tokensUsed: 0,
    archived: false,
    runner: 'claude',
    model: 'opus',
    steps: [{ id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 0, sessionId: 's-1' }],
    ...extra,
  }) as ApiRun

function renderTaskPage(record: ApiRun, implementation: ComponentImplementation<TaskMetadataProps> = compactTaskMetadata) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const body =
        path === '/api/v1/providers/status'
          ? { providers: [{ provider: 'claude', status: 'connected', enabled: true }] }
          : path === '/api/v1/health'
            ? { capabilities: { tokenMetrics: true, tokenUsageMetrics: true, costMetrics: true, automations: true } }
            : []
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )

  const queryClient = createQueryClient()
  const registry = createCoreComponentRegistry()
  registry.forExtension(fakeScope('test.compact-task-metadata').scope).provide(TaskMetadata, implementation)
  const preferenceOf = (id: string) => (id === TaskMetadata.id ? implementation.id : null)

  render(
    <QueryClientProvider client={queryClient}>
      <CommandsProvider>
        <ComponentsProvider registry={registry} preferenceOf={preferenceOf}>
          <MemoryRouter>
            <ThreadView run={record} thread={reduceThread([])} />
          </MemoryRouter>
        </ComponentsProvider>
      </CommandsProvider>
    </QueryClientProvider>,
  )
}

describe('an independent task metadata implementation on the task page', () => {
  it('renders beside core’s title part and reaches the engine picker', async () => {
    renderTaskPage(run('done'))

    const metadataHost = document.querySelector<HTMLElement>('[data-contract="cezar.task.metadata"]')
    expect(metadataHost?.dataset.component).toBe(compactTaskMetadata.id)
    expect(metadataHost?.textContent).toContain('quick-task · cez/r1 · +2 -1 · claude/opus')
    expect(document.querySelector<HTMLElement>('[data-contract="cezar.task.header.main"] h1')?.textContent).toBe('Do the thing')

    await waitFor(() => expect((screen.getByLabelText('Reply to the agent') as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Choose engine' }))
    const model = screen.getByRole('button', { name: 'Model' })
    await waitFor(() => expect(document.activeElement).toBe(model))
  })

  it('falls back to core metadata without disturbing the title host when the implementation throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwing: ComponentImplementation<TaskMetadataProps> = {
      ...compactTaskMetadata,
      id: 'test.compact-task-metadata.throw',
      component: () => {
        throw new Error('compact metadata is down')
      },
    }

    renderTaskPage(run('done'), throwing)

    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-contract="cezar.task.metadata"]')?.dataset.component).toBe('cezar.task.metadata.default'))
    expect(document.querySelector<HTMLElement>('[data-contract="cezar.task.header.main"]')?.dataset.component).toBe('cezar.task.header.main.default')
    expect(consoleError).toHaveBeenCalled()
  })
})
