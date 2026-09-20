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
import { TaskArchive, TaskContinue, TaskHeaderMain, TaskStop, type ContributionId } from '@open-mercato/cezar-extension-api'
import { Toaster, resetToasts } from '@/components/ui/toaster'

// Test-only reach into another package, as the extension boundary requires: the real example must
// work without importing cockpit implementation modules.
import jiraTaskHeader from '../../../../extension-api/examples/jira-task-header/index'
import * as draftModule from '../../../../extension-api/examples/jira-task-header/draft'

import { reduceThread } from './thread-state'
import { ThreadView } from './task-thread'

const ROW_ID = 'example.jira-header.row'

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
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: undefined })
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
    branch: 'cez/r1',
    diffStat: { adds: 12, dels: 3, files: 1, repointed: true },
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

function stubClipboard(writeText: (text: string) => Promise<void> = async () => {}) {
  const write = vi.fn(writeText)
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: write } })
  return write
}

/** The same composition as `main.tsx`, with the example preferred for the header contract. */
async function renderTaskPage(record: ApiRun) {
  const queryClient = createQueryClient()
  const commands = createCommandRegistry()
  registerCoreCommands(commands, { queryClient })
  const events = createEventBus()
  const components = createCoreComponentRegistry()
  const host = startExtensionHost({
    extensions: [jiraTaskHeader],
    services: cockpitServices({ commands, events, components }),
    onStatusChange: extensionLifecycleEvents(events),
    onError: () => {},
  })
  const records = await host.ready
  expect(records.map((entry) => [entry.id, entry.status])).toEqual([['example.jira-header', 'active']])
  const execute = vi.spyOn(commands, 'execute')
  const preferenceOf = (contractId: ContributionId): ContributionId | null => (contractId === TaskHeaderMain.id ? ROW_ID : null)

  const tree = (next: ApiRun) => (
    <QueryClientProvider client={queryClient}>
      <CommandsProvider registry={commands}>
        <ComponentsProvider registry={components} preferenceOf={preferenceOf}>
          <MemoryRouter initialEntries={['/tasks/r1']}>
            <ThreadView run={next} thread={reduceThread([])} />
            <Toaster />
          </MemoryRouter>
        </ComponentsProvider>
      </CommandsProvider>
    </QueryClientProvider>
  )
  const view = render(tree(record))
  return { execute, view, rerender: (next: ApiRun) => view.rerender(tree(next)) }
}

const part = () => document.querySelector<HTMLElement>('[data-slot="run-header"] [data-slot="component-host"]')
const row = () => within(document.querySelector('[data-example="jira-task-header"]') as HTMLElement)
const actionBar = () => within(document.querySelector('[data-slot="run-actions"]') as HTMLElement)

describe('the Jira task header extension on the task page', () => {
  it('replaces core, shows its title and status, and gives up all three bar actions', async () => {
    stubFetch()
    await renderTaskPage(run('done'))

    expect(part()?.dataset.component).toBe(ROW_ID)
    expect(row().getByText('Do the thing')).not.toBeNull()
    expect(row().getByText('done')).not.toBeNull()
    const bar = [...actionBar().queryAllByRole('button')].map((button) => button.textContent?.trim())
    expect(bar).not.toContain('Continue')
    expect(bar).not.toContain('Cancel')
    expect(bar).not.toContain('Archive')
    expect(screen.getByRole('button', { name: 'Run actions' }).className).not.toContain('md:hidden')
  })

  it('continues and archives through the core commands', async () => {
    stubFetch()
    const { execute } = await renderTaskPage(run('done'))

    const continueButton = row().getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    await waitFor(() => expect(continueButton.disabled).toBe(false))
    fireEvent.click(continueButton)
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskContinue, { taskId: 'r1' }))
    fireEvent.click(row().getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskArchive, { taskId: 'r1', archived: true }))
  })

  it('keeps Stop behind core confirmation', async () => {
    stubFetch()
    const { execute } = await renderTaskPage(run('running'))

    expect(actionBar().queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(row().getByRole('button', { name: 'Stop' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(execute).not.toHaveBeenCalledWith(TaskStop, expect.anything())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(execute).not.toHaveBeenCalledWith(TaskStop, expect.anything())
    fireEvent.click(row().getByRole('button', { name: 'Stop' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel the run' }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(TaskStop, { taskId: 'r1' }))
  })

  it('gates controls and moves focus to the core engine picker', async () => {
    stubFetch()
    await renderTaskPage(run('running'))
    expect(row().queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(row().getByRole('button', { name: 'Stop' })).not.toBeNull()

    cleanup()
    stubFetch()
    await renderTaskPage(run('done'))
    await waitFor(() => expect((row().getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false))
    const choose = row().getByRole('button', { name: 'Choose engine' })
    fireEvent.click(choose)
    await waitFor(() => expect(document.activeElement?.closest('[data-slot="follow-up-engine"]')).not.toBeNull())
  })

  it('supports rename and restores the example after the title editor closes', async () => {
    stubFetch()
    await renderTaskPage(run('done'))
    fireEvent.click(row().getByRole('button', { name: 'Rename task' }))
    expect(document.querySelector('[data-slot="title-editor"]')).not.toBeNull()
    fireEvent.keyDown(document.querySelector('[data-slot="title-editor"] input') as HTMLElement, { key: 'Escape' })
    await waitFor(() => expect(part()?.dataset.component).toBe(ROW_ID))
  })

  it('opens, edits and copies its own Jira draft without commands or non-GET requests', async () => {
    const sent = stubFetch()
    const write = stubClipboard()
    const { execute } = await renderTaskPage(run('done'))

    fireEvent.click(row().getByRole('button', { name: 'Draft Jira issue' }))
    const panel = await screen.findByRole('dialog', { name: 'Jira issue draft' })
    const summary = within(panel).getByRole('textbox', { name: 'Summary' }) as HTMLInputElement
    expect(document.activeElement).toBe(summary)
    expect(summary.value).toBe('Do the thing')
    expect((within(panel).getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toContain('Branch: cez/r1')
    fireEvent.change(summary, { target: { value: 'Edited issue summary' } })
    expect(summary.value).toBe('Edited issue summary')
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy summary' }))
    await waitFor(() => expect(write).toHaveBeenCalledWith('Edited issue summary'))
    expect(within(panel).getByRole('button', { name: 'Copied' })).not.toBeNull()
    expect(execute).not.toHaveBeenCalled()
    expect(sent.filter((request) => request.method !== 'GET')).toEqual([])
  })

  it('handles clipboard failure, Escape and outside closing without leaking listeners', async () => {
    stubFetch()
    stubClipboard(async () => Promise.reject(new Error('denied')))
    await renderTaskPage(run('done'))
    const trigger = row().getByRole('button', { name: 'Draft Jira issue' })
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'Jira issue draft' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy summary' }))
    expect(await screen.findByText('Copy failed. Select the text and copy it yourself.')).not.toBeNull()
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Jira issue draft' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    const reopened = await screen.findByRole('dialog', { name: 'Jira issue draft' })
    fireEvent.pointerDown(reopened)
    expect(screen.queryByRole('dialog', { name: 'Jira issue draft' })).not.toBeNull()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Jira issue draft' })).toBeNull())
    expect(reopened).not.toBeNull()
    fireEvent.click(row().getByRole('button', { name: 'Draft Jira issue' }))
    const noClipboardPanel = await screen.findByRole('dialog', { name: 'Jira issue draft' })
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: undefined })
    fireEvent.click(within(noClipboardPanel).getByRole('button', { name: 'Copy description' }))
    expect(await screen.findByText('Copy failed. Select the text and copy it yourself.')).not.toBeNull()
    cleanup()
    fireEvent.pointerDown(document.body)
  })

  it('resets the local draft when the host changes task without remounting', async () => {
    stubFetch()
    const { rerender } = await renderTaskPage(run('done'))
    fireEvent.click(row().getByRole('button', { name: 'Draft Jira issue' }))
    const summary = (await screen.findByRole('textbox', { name: 'Summary' })) as HTMLInputElement
    fireEvent.change(summary, { target: { value: 'Task A edit' } })
    rerender(run('done', { id: 'r2', title: 'another task', titleSummary: 'Another task', task: 'Another request' }))
    expect(screen.queryByRole('dialog', { name: 'Jira issue draft' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Draft Jira issue' }))
    expect((await screen.findByRole('textbox', { name: 'Summary' }) as HTMLInputElement).value).toBe('Another task')
  })

  it('falls back to core when the real example throws while rendering', async () => {
    stubFetch()
    const thrower = vi.spyOn(draftModule, 'draftJiraIssue').mockImplementation(() => {
      throw new Error('example failure')
    })
    await renderTaskPage(run('done'))
    fireEvent.click(row().getByRole('button', { name: 'Draft Jira issue' }))
    await waitFor(() => expect(part()?.dataset.component).toBe('cezar.task.header.main.default'))
    expect(actionBar().getByRole('button', { name: 'Continue' })).not.toBeNull()
    expect(actionBar().getByRole('button', { name: 'Archive' })).not.toBeNull()
    thrower.mockRestore()
  })
})
