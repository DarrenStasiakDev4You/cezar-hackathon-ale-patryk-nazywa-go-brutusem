import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { registerCoreCommands } from '@/commands/core-commands'
import { CommandsProvider } from '@/commands/provider'
import { createCommandRegistry } from '@/commands/registry'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { ComponentsProvider } from '@/component-registry/provider'
import { createEventBus } from '@/events/bus'
import { cockpitServices, extensionLifecycleEvents, startExtensionHost } from '@/extensions/host'
import type { ApiRun, RunStatus } from '@open-mercato/cezar-api-client'
import { TaskArchive, TaskContinue, TaskHeader, TaskStop, type ContributionId } from '@open-mercato/cezar-extension-api'
import { Toaster, resetToasts } from '@/components/ui/toaster'

// A test-only reach into another package, ugly on purpose (AGENTS.md): the example is the proof
// that a task header can be written without importing anything from `packages/web`.
import compactTaskHeader from '../../../../extension-api/examples/compact-task-header/index'

import { reduceThread } from './thread-state'
import { ThreadView } from './task-thread'

/**
 * The brief's Definition of Done on the task page (spec `.ai/specs/2026-09-19-task-header-contract.md`,
 * Implementation Plan step 10): the compact example, activated through the extension host the way
 * `main.tsx` activates extensions and preferred for `task.header`, renders the task's
 * header and runs Continue, Stop (after core's confirmation) and Archive through core's intents.
 */

const ROW_ID = 'example.compact-header.row'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  resetToasts()
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
    tokensUsed: 0,
    archived: false,
    runner: 'claude',
    model: 'opus',
    steps: [{ id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 0, sessionId: 's-1' }],
    ...extra,
  }) as ApiRun

interface SentRequest {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

function stubFetch(): SentRequest[] {
  const sent: SentRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input)
      const method = init.method ?? 'GET'
      sent.push({ path, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
      const body =
        path === '/api/v1/providers/status'
          ? { providers: [{ provider: 'claude', status: 'connected', enabled: true }] }
          : path === '/api/v1/runs'
            ? []
            : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return sent
}

/** The page as `main.tsx` builds it — registries first, then the extension host — with the example preferred. */
async function renderTaskPage(record: ApiRun) {
  const queryClient = createQueryClient()
  const commands = createCommandRegistry()
  registerCoreCommands(commands, { queryClient })
  const events = createEventBus()
  const components = createCoreComponentRegistry()
  const host = startExtensionHost({
    extensions: [compactTaskHeader],
    services: cockpitServices({ commands, events, components }),
    onStatusChange: extensionLifecycleEvents(events),
    onError: () => {},
  })
  const records = await host.ready
  expect(records.map((entry) => [entry.id, entry.status])).toEqual([['example.compact-header', 'active']])
  const execute = vi.spyOn(commands, 'execute')
  const preferenceOf = (contractId: ContributionId): ContributionId | null => (contractId === TaskHeader.id ? ROW_ID : null)

  render(
    <QueryClientProvider client={queryClient}>
      <CommandsProvider registry={commands}>
        <ComponentsProvider registry={components} preferenceOf={preferenceOf}>
          <MemoryRouter initialEntries={['/tasks/r1']}>
            <ThreadView run={record} thread={reduceThread([])} />
            <Toaster />
          </MemoryRouter>
        </ComponentsProvider>
      </CommandsProvider>
    </QueryClientProvider>,
  )
  return { execute }
}

const part = () => document.querySelector<HTMLElement>('[data-slot="run-header"] [data-slot="component-host"]')
const row = () => within(document.querySelector('[data-example="compact-task-header"]') as HTMLElement)
const actionBar = () => within(document.querySelector('[data-slot="run-actions"]') as HTMLElement)

describe('a task header from a separate package, on the task page', () => {
  it('renders the example’s row: the title, the status label and runner · model', async () => {
    stubFetch()
    await renderTaskPage(run('done'))

    expect(part()?.dataset.component).toBe(ROW_ID)
    expect(part()?.dataset.state).toBe('resolved')
    expect(row().getByText('Do the thing')).not.toBeNull()
    expect(row().getByText('done')).not.toBeNull()
    expect(row().getByText('claude · opus')).not.toBeNull()
  })

  it('takes Continue, Cancel and Archive out of core’s bar, and keeps the Run actions menu visible', async () => {
    stubFetch()
    await renderTaskPage(run('done'))

    const bar = [...actionBar().queryAllByRole('button')].map((button) => button.textContent?.trim())
    expect(bar).not.toContain('Continue')
    expect(bar).not.toContain('Archive')
    expect(bar).toContain('Notes')
    expect(screen.getByRole('button', { name: 'Run actions' }).className).not.toContain('md:hidden')
  })

  it('its Continue continues the task, and its Archive archives it, through core', async () => {
    const sent = stubFetch()
    const { execute } = await renderTaskPage(run('done'))

    const continueButton = row().getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    await waitFor(() => expect(continueButton.disabled).toBe(false))
    fireEvent.click(continueButton)
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskContinue, { taskId: 'r1' }))

    fireEvent.click(row().getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskArchive, { taskId: 'r1', archived: true }))
    await waitFor(() => expect(sent.find((request) => request.path === '/api/v1/runs/r1/archive')?.body).toEqual({ archived: true }))
  })

  it('its Stop opens core’s confirmation, and only Cancel the run stops the task', async () => {
    stubFetch()
    const { execute } = await renderTaskPage(run('running'))

    expect([...actionBar().queryAllByRole('button')].map((button) => button.textContent?.trim())).not.toContain('Cancel')
    fireEvent.click(row().getByRole('button', { name: 'Stop' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(execute).not.toHaveBeenCalledWith(TaskStop, expect.anything())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel the run' }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskStop, { taskId: 'r1' }))
  })
})
