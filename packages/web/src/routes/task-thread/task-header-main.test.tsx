import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskHeaderMain, type TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'
import type { ApiRun, RunStatus, StepState } from '@open-mercato/cezar-api-client'

import { ProjectScopeContext } from '@/api/project-scope-context'
import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import { registerCoreComponents } from '@/component-registry/core-components'
import { CORE_COMPONENT_CONTRACTS } from '@/component-registry/core-contracts'
import { ComponentsProvider } from '@/component-registry/provider'
import { createComponentRegistry } from '@/component-registry/registry'
import { resetToasts } from '@/components/ui/toaster'
import { fakeScope } from '@/extensions/registry.fixtures'
import { runTitle } from '@/lib/task-groups'
import { workflowLabel } from '@/lib/tasks-table'

import { CoreTaskHeaderMain } from './core-task-header-main'
import { RunHeader } from './run-header'
import { useTaskHeaderMainProps } from './task-header-main'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      new Response(String(input).endsWith('/runs') ? '[]' : '{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  act(() => resetToasts())
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const step = (extra: Partial<StepState> = {}): StepState => ({
  id: 'task',
  name: 'Do the task',
  kind: 'agent',
  status: 'done',
  iterations: 1,
  tokensUsed: 0,
  ...extra,
})

const run = (status: RunStatus, extra: Partial<ApiRun> = {}): ApiRun => ({
  id: 'r1',
  title: 'do the thing plz',
  titleSummary: 'Do the thing',
  workflow: 'quick-task',
  task: 'Summarize what this project does.',
  status,
  createdAt: '2026-07-14T12:00:00.000Z',
  tokensUsed: 27_000,
  archived: false,
  steps: [step({ sessionId: 'sess-1' })],
  ...extra,
})

/** A router at `path`, as the task routes mount; `scoped` adds the project scope context. */
const at =
  (path: string, scoped?: string) =>
  ({ children }: { children: ReactNode }) => {
    const routed = <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    return scoped === undefined ? (
      routed
    ) : (
      <ProjectScopeContext.Provider value={{ projectId: scoped, apiBase: `/api/v1/p/${scoped}` }}>
        {routed}
      </ProjectScopeContext.Provider>
    )
  }

describe('useTaskHeaderMainProps', () => {
  it('names the task from runTitle and the boot project’s URL, whose scope context is null', () => {
    const record = run('running')
    const { result } = renderHook(() => useTaskHeaderMainProps(record), { wrapper: at('/p/boot/tasks/r1') })

    expect(result.current.task).toEqual({ taskId: 'r1', projectId: 'boot', title: runTitle(record), status: 'running' })
    expect(result.current.task.title).toBe('Do the thing')
  })

  it('takes the project from the scope context when there is one', () => {
    const { result } = renderHook(() => useTaskHeaderMainProps(run('done')), { wrapper: at('/tasks/r1', 'web') })

    expect(result.current.task.projectId).toBe('web')
  })

  it('carries what the meta row shows: the workflow label, the branch and the diff', () => {
    const record = run('review', {
      workflow: '(planned)',
      steps: [step({ name: 'Plan the work' })],
      branch: 'cez/r1',
      diffStat: { adds: 12, dels: 3, files: 2 },
    })
    const { result } = renderHook(() => useTaskHeaderMainProps(record, { done: 2, total: 5 }), {
      wrapper: at('/p/boot/tasks/r1'),
    })

    expect(result.current.meta).toEqual({
      workflow: workflowLabel(record),
      branch: 'cez/r1',
      diff: { added: 12, removed: 3 },
    })
    expect(result.current.meta.workflow).toBe('Plan the work')
    expect(result.current.plan).toEqual({ done: 2, total: 5 })
  })

  it('leaves out what the run does not have yet', () => {
    const { result } = renderHook(() => useTaskHeaderMainProps(run('queued')), { wrapper: at('/p/boot/tasks/r1') })

    expect(result.current).toEqual({
      task: { taskId: 'r1', projectId: 'boot', title: 'Do the thing', status: 'queued' },
      meta: { workflow: 'quick-task' },
    })
    expect('plan' in result.current).toBe(false)
    expect('branch' in result.current.meta).toBe(false)
  })

  it('stays the same object for the same values, and freezes every level', () => {
    const { result, rerender } = renderHook(
      ({ record, tally }: { record: ApiRun; tally?: { done: number; total: number } }) =>
        useTaskHeaderMainProps(record, tally),
      {
        wrapper: at('/p/boot/tasks/r1'),
        initialProps: { record: run('running', { branch: 'cez/r1', diffStat: { adds: 1, dels: 0, files: 1 } }), tally: { done: 1, total: 3 } },
      },
    )
    const first = result.current

    // A new run record and a new tally with the same values: what a cache patch or a re-render passes.
    rerender({ record: run('running', { branch: 'cez/r1', diffStat: { adds: 1, dels: 0, files: 1 } }), tally: { done: 1, total: 3 } })
    expect(result.current).toBe(first)

    for (const part of [first, first.task, first.meta, first.meta.diff, first.plan]) {
      expect(Object.isFrozen(part)).toBe(true)
    }
    expect(() => {
      ;(first.task as { title: string }).title = 'Renamed'
    }).toThrow(TypeError)

    rerender({ record: run('review', { branch: 'cez/r1', diffStat: { adds: 1, dels: 0, files: 1 } }), tally: { done: 1, total: 3 } })
    expect(result.current).not.toBe(first)
    expect(result.current.task.status).toBe('review')
  })
})

describe('CoreTaskHeaderMain', () => {
  it('throws outside the shell’s context', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const props: TaskHeaderMainProps = {
      task: { taskId: 'r1', projectId: 'boot', title: 'Do the thing', status: 'running' },
      meta: { workflow: 'quick-task' },
    }

    expect(() => render(<CoreTaskHeaderMain {...props} />)).toThrow(/RunHeader/)
  })
})

describe('RunHeader with an extension’s implementation of the main part', () => {
  const JIRA_ID = 'acme.jira.task-header'

  function JiraHeader({ task, meta }: TaskHeaderMainProps) {
    return (
      <h1 data-testid="jira-header">
        JIRA · {task.title} · {task.status} · {task.projectId} · {meta.workflow}
      </h1>
    )
  }

  function renderWithJira(record: ApiRun) {
    const registry = createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS, onDiagnostic: () => {} })
    registerCoreComponents(registry)
    registry.forExtension(fakeScope('acme.jira').scope).provide(TaskHeaderMain, {
      id: JIRA_ID,
      title: 'Jira header',
      capabilities: ['shows-title', 'shows-status'],
      component: JiraHeader,
    })
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <CommandsProvider>
          <ComponentsProvider
            registry={registry}
            preferenceOf={(contractId) => (contractId === TaskHeaderMain.id ? JIRA_ID : null)}
          >
            <MemoryRouter initialEntries={['/p/boot/tasks/r1']}>
              <Routes>
                <Route path="/p/:projectId/tasks/:id" element={<RunHeader run={record} />} />
              </Routes>
            </MemoryRouter>
          </ComponentsProvider>
        </CommandsProvider>
      </QueryClientProvider>,
    )
  }

  it('renders it in place of core’s rows, and keeps the actions and the tabs', () => {
    const { container } = renderWithJira(run('review'))

    expect(screen.getByTestId('jira-header').textContent).toBe('JIRA · Do the thing · review · boot · quick-task')
    const box = container.querySelector<HTMLElement>('[data-slot="component-host"]')
    expect(box?.dataset.contract).toBe('cezar.task.header.main')
    expect(box?.dataset.component).toBe(JIRA_ID)
    // Core's rows are gone: no rename pencil, no meta row.
    expect(screen.queryByRole('button', { name: 'Rename task' })).toBeNull()
    expect(container.querySelector('[data-slot="run-meta"]')).toBeNull()

    // Core keeps the task's controls around the slot.
    const actions = container.querySelector<HTMLElement>('[data-slot="run-actions"]')
    expect(actions).not.toBeNull()
    expect(within(actions!).getByRole('button', { name: /Notes/ })).toBeTruthy()
    expect(within(actions!).getByRole('button', { name: /Finish/ })).toBeTruthy()
    const tabs = container.querySelector<HTMLElement>('[data-slot="run-tabs"]')
    expect(within(tabs!).getByRole('link', { name: 'Session' })).toBeTruthy()
    expect(within(tabs!).getByRole('link', { name: 'Changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run actions' })).toBeTruthy()
  })
})
