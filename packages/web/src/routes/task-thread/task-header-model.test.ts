import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectScopeProvider } from '@/api/project-scope-context'
import { rememberReferenceStatuses } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import type { ApiRun, RunStatus, StepState } from '@open-mercato/cezar-api-client'
import { ReferenceStatusRegistry } from '@/components/reference-status'
import { Toaster, resetToasts } from '@/components/ui/toaster'
import { deriveAttention } from '@/lib/attention'
import { workflowLabel } from '@/lib/tasks-table'

import { resolveConflictsPrompt, runActionFlags } from './run-actions'
import { useTaskHeaderModel, type TaskHeaderModel, type TaskHeaderModelOptions } from './task-header-model'

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
  inputTokens: 24_600,
  outputTokens: 2_400,
  archived: false,
  steps: [step({ sessionId: 'sess-1' })],
  ...extra,
})

interface SentRequest {
  path: string
  method: string
  body: unknown
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const connected = () =>
  jsonResponse({
    providers: [
      { provider: 'claude', status: 'connected', enabled: true },
      { provider: 'codex', status: 'not-installed', enabled: true },
      { provider: 'opencode', status: 'not-installed', enabled: true },
    ],
  })

/** Stubs fetch and records every request. An override answers one path; `hang` never answers. */
function stubFetch(overrides: Record<string, () => Response | Promise<Response>> = {}): SentRequest[] {
  const sent: SentRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input)
      const method = init.method ?? 'GET'
      sent.push({ path, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
      const override = overrides[path]
      if (override) return override()
      if (method === 'GET' && path === '/api/v1/runs') return jsonResponse([])
      if (method === 'GET' && path === '/api/v1/providers/status') return connected()
      return jsonResponse({})
    }),
  )
  return sent
}

const hang = () => new Promise<Response>(() => {})

const HEALTH_ON = {
  bootProject: 'boot',
  capabilities: {
    localHandoff: true, followups: false, singleProject: false, automations: true,
    tokenMetrics: true, tokenUsageMetrics: true, costMetrics: true,
  },
}

/** Where the router is, for the navigation tests. */
let location = ''
function LocationProbe() {
  location = useLocation().pathname
  return null
}

type HookProps = { record: ApiRun; options?: Partial<TaskHeaderModelOptions> }

function renderModel(record: ApiRun, { path = '/tasks/r1', options = {} }: { path?: string; options?: Partial<TaskHeaderModelOptions> } = {}) {
  const client = createQueryClient()
  const requestStopConfirmation = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        CommandsProvider,
        null,
        createElement(MemoryRouter, { initialEntries: [path] }, children, createElement(LocationProbe), createElement(Toaster)),
      ),
    )
  const hook = renderHook<TaskHeaderModel, HookProps>(
    ({ record: current, options: extra }) => useTaskHeaderModel(current, { requestStopConfirmation, ...extra }),
    { wrapper, initialProps: { record, options } },
  )
  return { ...hook, requestStopConfirmation }
}

const requestsTo = (sent: SentRequest[], path: string) => sent.filter((request) => request.method === 'POST' && request.path === path)

describe('useTaskHeaderModel: the data', () => {
  it('names the task, its prompt and its status as the task list does', () => {
    stubFetch()
    const record = run('waiting', { archived: true })
    const { result } = renderModel(record)

    expect(result.current.props.task).toEqual({
      taskId: 'r1',
      projectId: '',
      title: 'Do the thing',
      prompt: 'Summarize what this project does.',
      status: 'waiting',
      archived: true,
    })
    const attention = deriveAttention(record)
    expect(result.current.props.attention).toEqual({ label: attention.label, tone: attention.tone, pulse: attention.pulse })
  })

  it('carries a queued task’s place in the project’s queue', async () => {
    stubFetch({
      '/api/v1/runs': () =>
        jsonResponse([
          run('queued', { id: 'r0', createdAt: '2026-07-14T11:00:00.000Z' }),
          run('queued', { id: 'r1' }),
        ]),
    })
    const { result } = renderModel(run('queued'))

    await waitFor(() => expect(result.current.props.attention.queuePosition).toBe(2))
    expect(result.current.props.attention.label).toBe(deriveAttention(run('queued')).label)
  })

  it('shows the workflow’s display name, the branch, and the diff with its file count and caveat', () => {
    stubFetch()
    const inline = run('done', {
      workflow: '(planned)',
      steps: [step({ name: 'fix-login', sessionId: 'sess-1' })],
      branch: 'cez/r1',
      diffStat: { adds: 12, dels: 3, files: 4, repointed: true },
    })
    const { result } = renderModel(inline)

    expect(result.current.props.meta.workflow).toBe(workflowLabel(inline))
    expect(result.current.props.meta.workflow).toBe('fix-login')
    expect(result.current.props.meta.branch).toBe('cez/r1')
    expect(result.current.props.meta.diff).toEqual({ added: 12, removed: 3, files: 4, repointed: true })
  })

  it('leaves out what the record does not carry', () => {
    stubFetch()
    const { result } = renderModel(run('done', { inputTokens: undefined, outputTokens: undefined }))

    expect(result.current.props.meta).toEqual({ workflow: 'quick-task' })
    expect(result.current.props.plan).toBeUndefined()
  })

  it('carries the plan tally it is given', () => {
    stubFetch()
    const { result } = renderModel(run('running'), { options: { planTally: { done: 2, total: 5 } } })

    expect(result.current.props.plan).toEqual({ done: 2, total: 5 })
  })

  it('lists every PR, then a PR known only by URL, then the issue, in the Tasks table’s order', async () => {
    stubFetch({
      '/api/v1/health': () => jsonResponse({ bootProject: 'acme', repo: { remote: 'https://github.com/open-mercato/cezar.git' } }),
    })
    const { result } = renderModel(
      run('done', {
        pullRequestUrl: 'https://github.com/open-mercato/cezar/pull/5366',
        referencedPullRequestUrl: 'https://github.com/open-mercato/cezar/pull/4326',
        markerRefs: { pr: 5366 },
      }),
    )

    await waitFor(() =>
      expect(result.current.props.meta.references?.map(({ kind, number, url }) => ({ kind, number, url }))).toEqual([
        { kind: 'pr', number: 5366, url: 'https://github.com/open-mercato/cezar/pull/5366' },
        { kind: 'pr', number: 4326, url: 'https://github.com/open-mercato/cezar/pull/4326' },
      ]),
    )

    cleanup()
    stubFetch({ '/api/v1/health': () => jsonResponse({ repo: {} }) })
    const forge = renderModel(
      run('done', { pullRequestUrl: 'https://forge.example.com/o/r/merge_requests/spec-fix', prNumber: 42 }),
    )
    expect(forge.result.current.props.meta.references).toEqual([
      { kind: 'pr', number: 42 },
      { kind: 'pr', url: 'https://forge.example.com/o/r/merge_requests/spec-fix' },
    ])
  })

  it('synthesizes the issue from the CEZ:ISSUE marker against the project’s own repository', async () => {
    stubFetch({
      '/api/v1/health': () => jsonResponse({ repo: { remote: 'https://github.com/open-mercato/cezar.git' } }),
    })
    const { result } = renderModel(run('done', { markerRefs: { issue: 524 } }))

    await waitFor(() =>
      expect(result.current.props.meta.references).toEqual([
        expect.objectContaining({ kind: 'issue', number: 524, url: 'https://github.com/open-mercato/cezar/issues/524' }),
      ]),
    )
  })

  it('carries each reference’s forge status, look-up state and conflict flag', async () => {
    stubFetch({
      '/api/v1/health': () => jsonResponse({ bootProject: 'acme' }),
      '/api/v1/p/acme/github/ref-status?prs=7101': () =>
        jsonResponse({ available: true, prs: { 7101: 'ready' }, issues: {}, conflicts: [7101], recheckAfterMs: null }),
    })
    const { result } = renderModel(run('done', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7101' }))

    await waitFor(() =>
      expect(result.current.props.meta.references).toEqual([
        { kind: 'pr', number: 7101, url: 'https://github.com/o/r/pull/7101', status: 'ready', lookup: 'ready', conflicting: true },
      ]),
    )
  })

  // Review of #37: the look-up answers `idle` (nothing asked on this surface yet, or past the
  // per-project cap) WITH the status it remembers, and the chip always painted it.
  it('carries a remembered status while nothing has been asked yet', () => {
    stubFetch()
    rememberReferenceStatuses({ acme: { prs: { 7105: 'merged' }, issues: {} } })
    const client = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          CommandsProvider,
          null,
          createElement(
            MemoryRouter,
            { initialEntries: ['/p/acme/tasks/r1'] },
            createElement(ProjectScopeProvider, { projectId: 'acme', children: createElement(ReferenceStatusRegistry, { children }) }),
          ),
        ),
      )
    const firstRender: unknown[] = []
    renderHook(
      () => {
        const model = useTaskHeaderModel(run('done', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7105' }), {
          requestStopConfirmation: () => {},
        })
        if (firstRender.length === 0) firstRender.push(model.props.meta.references?.[0])
        return model
      },
      { wrapper },
    )

    // The first render, before the header's requests reach the registry: the look-up is idle.
    expect(firstRender[0]).toEqual({ kind: 'pr', number: 7105, url: 'https://github.com/o/r/pull/7105', status: 'merged' })
  })

  it('says why a look-up is unavailable', async () => {
    stubFetch({
      '/api/v1/health': () => jsonResponse({ bootProject: 'acme' }),
      '/api/v1/p/acme/github/ref-status?prs=7102': () =>
        jsonResponse({ available: false, reason: 'gh CLI not found', prs: {}, issues: {}, recheckAfterMs: null }),
    })
    const { result } = renderModel(run('done', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7102' }))

    await waitFor(() =>
      expect(result.current.props.meta.references?.[0]).toMatchObject({ lookup: 'unavailable', lookupReason: 'gh CLI not found' }),
    )
    expect(result.current.props.meta.references?.[0]?.status).toBeUndefined()
  })

  it('leaves out every usage metric the server hides', async () => {
    stubFetch({
      '/api/v1/health': () =>
        jsonResponse({ capabilities: { ...HEALTH_ON.capabilities, tokenUsageMetrics: false, costMetrics: true } }),
    })
    const { result } = renderModel(run('done', { costUsd: 0.04 }))

    await waitFor(() => expect(result.current.props.meta.usage).toEqual({ costUsd: 0.04 }))

    cleanup()
    stubFetch({
      '/api/v1/health': () =>
        jsonResponse({ capabilities: { ...HEALTH_ON.capabilities, tokenUsageMetrics: true, costMetrics: false } }),
    })
    const tokens = renderModel(run('done', { costUsd: 0.04 }))
    await waitFor(() => expect(tokens.result.current.props.meta.usage).toEqual({ inputTokens: 24_600, outputTokens: 2_400 }))
  })

  describe('the automation link', () => {
    const automated = (extra: Partial<ApiRun> = {}) =>
      run('done', {
        automation: { automationId: 'a-1', automationRevision: 1, receiptId: 'r-1', event: 'issue.opened', githubUrl: 'https://github.com/o/r/issues/801' },
        ...extra,
      })

    it('is set only while automations are on', async () => {
      stubFetch({ '/api/v1/health': () => jsonResponse(HEALTH_ON) })
      const on = renderModel(automated())
      await waitFor(() =>
        expect(on.result.current.props.meta.automation).toEqual({ automationId: 'a-1', href: '/automations/a-1/log' }),
      )

      cleanup()
      stubFetch({ '/api/v1/health': () => jsonResponse({ capabilities: { ...HEALTH_ON.capabilities, automations: false } }) })
      const off = renderModel(automated())
      await waitFor(() => expect(off.result.current.props.meta.automation).toEqual({ automationId: 'a-1' }))
    })

    it('is scoped to the project the task page shows', async () => {
      stubFetch({ '/api/v1/health': () => jsonResponse(HEALTH_ON) })
      const { result } = renderModel(automated(), { path: '/p/web/tasks/r1' })

      await waitFor(() =>
        expect(result.current.props.meta.automation?.href).toBe('/p/web/automations/a-1/log'),
      )
    })
  })

  it('names the project the task page shows: its own, the boot project’s, or none at an unscoped test path', () => {
    stubFetch()
    expect(renderModel(run('done'), { path: '/p/web/tasks/r1' }).result.current.props.task.projectId).toBe('web')
    cleanup()
    expect(renderModel(run('done'), { path: '/p/boot/tasks/r1' }).result.current.props.task.projectId).toBe('boot')
    cleanup()
    expect(renderModel(run('done')).result.current.props.task.projectId).toBe('')
  })

  describe('the engine', () => {
    it('falls back to the project’s default runner, and to `auto` for the model', async () => {
      stubFetch({ '/api/v1/config': () => jsonResponse({ defaultRunner: 'codex', defaultModels: {} }) })
      const { result } = renderModel(run('done', { runner: undefined, model: undefined }))

      await waitFor(() => expect(result.current.props.engine).toEqual({ runner: 'codex', model: 'auto' }))
    })

    it('names the account the last agent step ran under, and a removed one by its id', async () => {
      stubFetch({
        '/api/v1/workspace/agent-profiles': () =>
          jsonResponse({
            editable: true, profileCapableProviders: ['claude'], selections: {}, defaults: {},
            profiles: [
              { id: 'klaudiusz', provider: 'claude', label: 'Klaudiusz', configDir: '~/.c', path: '/c', exists: true, looksValid: true, isDefault: false, files: [] },
            ],
          }),
      })
      const labelled = renderModel(
        run('done', { runner: 'claude', model: 'opus', steps: [step({ profileId: 'default' }), step({ profileId: 'klaudiusz' })] }),
      )
      await waitFor(() => expect(labelled.result.current.props.engine).toEqual({ runner: 'claude', model: 'opus', account: 'Klaudiusz' }))

      labelled.rerender({ record: run('done', { runner: 'claude', model: 'opus', steps: [step({ profileId: 'gone' })] }) })
      expect(labelled.result.current.props.engine.account).toBe('gone (removed)')
      labelled.rerender({ record: run('done', { runner: 'claude', model: 'opus', steps: [step({ profileId: 'default' })] }) })
      expect(labelled.result.current.props.engine.account).toBe('default')
    })

    it('carries the resolved identity only when it says something the model does not', () => {
      stubFetch()
      const { result, rerender } = renderModel(run('done', { runner: 'claude', model: 'opus', modelIdentity: 'anthropic/claude-opus-4-8' }))
      expect(result.current.props.engine.identity).toBe('anthropic/claude-opus-4-8')

      rerender({ record: run('done', { runner: 'claude', model: 'anthropic/claude-opus-4-8', modelIdentity: 'anthropic/claude-opus-4-8' }) })
      expect(result.current.props.engine).not.toHaveProperty('identity')
    })
  })

  it.each<RunStatus>(['queued', 'running', 'waiting', 'review', 'done', 'failed', 'cancelled'])(
    'offers the actions runActionFlags gives a %s task',
    async (status) => {
      stubFetch()
      const record = run(status)
      const { result } = renderModel(record)
      const flags = runActionFlags(record)

      await waitFor(() => expect(result.current.props.actions.continue.enabled).toBe(flags.continueRun))
      expect(result.current.props.actions.continue.available).toBe(flags.continueRun)
      expect(result.current.props.actions.stop).toEqual({ available: flags.cancel, enabled: flags.cancel, pending: false })
      expect(result.current.props.actions.archive).toEqual({ available: flags.archive, enabled: flags.archive, pending: false })
    },
  )

  it.each([
    ['still checking', hang, 'Checking agent providers…'],
    ['in error', () => jsonResponse({ error: 'boom' }, 400), 'Provider authentication could not be verified.'],
    [
      'not connected',
      () => jsonResponse({ providers: [{ provider: 'claude', status: 'disconnected', enabled: true }] }),
      'Connect an agent provider to continue.',
    ],
  ])('disables Continue with the reason while providers are %s', async (_label, providers, reason) => {
    stubFetch({ '/api/v1/providers/status': providers })
    const { result } = renderModel(run('done'))

    await waitFor(() => expect(result.current.props.actions.continue).toEqual({ available: true, enabled: false, pending: false, reason }))
  })
})

describe('useTaskHeaderModel: the intents', () => {
  it('onContinue continues the task, naming a runner only when its own is not connected', async () => {
    const sent = stubFetch()
    const { result } = renderModel(run('done', { runner: 'claude' }))
    await waitFor(() => expect(result.current.props.actions.continue.enabled).toBe(true))
    act(() => result.current.props.onContinue())
    await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r1/continue')).toHaveLength(1))
    expect(requestsTo(sent, '/api/v1/runs/r1/continue')[0]?.body).toEqual({})

    cleanup()
    const fallback = stubFetch({
      '/api/v1/providers/status': () =>
        jsonResponse({
          providers: [
            { provider: 'claude', status: 'disconnected', enabled: true },
            { provider: 'codex', status: 'connected', enabled: true },
          ],
        }),
    })
    const other = renderModel(run('done', { runner: 'claude' }))
    await waitFor(() => expect(other.result.current.props.actions.continue.enabled).toBe(true))
    act(() => other.result.current.props.onContinue())
    await waitFor(() => expect(requestsTo(fallback, '/api/v1/runs/r1/continue')[0]?.body).toEqual({ runner: 'codex' }))
  })

  it('onStop asks for confirmation and never stops; stopTask stops', async () => {
    const sent = stubFetch()
    const { result, requestStopConfirmation } = renderModel(run('running'))

    act(() => result.current.props.onStop())
    expect(requestStopConfirmation).toHaveBeenCalledTimes(1)
    expect(requestsTo(sent, '/api/v1/runs/r1/cancel')).toHaveLength(0)

    act(() => result.current.stopTask())
    await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r1/cancel')).toHaveLength(1))
  })

  it('onArchive archives, and restores an archived task', async () => {
    const sent = stubFetch()
    const { result, rerender } = renderModel(run('done'))
    act(() => result.current.props.onArchive())
    await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r1/archive')[0]?.body).toEqual({ archived: true }))

    rerender({ record: run('done', { archived: true }) })
    await waitFor(() => expect(result.current.props.actions.archive.pending).toBe(false))
    act(() => result.current.props.onArchive())
    await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r1/archive')[1]?.body).toEqual({ archived: false }))
  })

  describe('onResolveConflicts', () => {
    const conflicting = (number: number, extra: Record<string, () => Response | Promise<Response>> = {}) =>
      stubFetch({
        '/api/v1/health': () => jsonResponse({ bootProject: 'acme' }),
        [`/api/v1/p/acme/github/ref-status?prs=${number}`]: () =>
          jsonResponse({ available: true, prs: { [number]: 'ready' }, issues: {}, conflicts: [number], recheckAfterMs: null }),
        ...extra,
      })

    it('sends the prompt once for a conflicting PR, and ignores any other number', async () => {
      const sent = conflicting(7201)
      const { result } = renderModel(run('running', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7201' }))
      await waitFor(() => expect(result.current.props.actions.resolveConflicts.enabled).toBe(true))

      act(() => result.current.props.onResolveConflicts(9999))
      act(() => result.current.props.onResolveConflicts(7201))
      await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r1/messages')).toHaveLength(1))
      expect(requestsTo(sent, '/api/v1/runs/r1/messages')[0]?.body).toMatchObject({ text: resolveConflictsPrompt(7201) })
    })

    it('is not offered without a conflicting reference, and does nothing then', async () => {
      const sent = stubFetch({ '/api/v1/health': () => jsonResponse({ bootProject: 'acme' }) })
      const { result } = renderModel(run('running', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7202' }))

      expect(result.current.props.actions.resolveConflicts.available).toBe(false)
      act(() => result.current.props.onResolveConflicts(7202))
      await act(() => Promise.resolve())
      expect(requestsTo(sent, '/api/v1/runs/r1/messages')).toHaveLength(0)
    })

    it('is offered but not enabled when the task has no session to deliver to, and does nothing then', async () => {
      const sent = conflicting(7203)
      const { result } = renderModel(
        run('done', { steps: [step()], referencedPullRequestUrl: 'https://github.com/o/r/pull/7203' }),
      )
      await waitFor(() => expect(result.current.props.actions.resolveConflicts.available).toBe(true))

      expect(result.current.props.actions.resolveConflicts.enabled).toBe(false)
      expect(result.current.props.actions.resolveConflicts.reason).toMatch(/no agent session was recorded/)
      act(() => result.current.props.onResolveConflicts(7203))
      await act(() => Promise.resolve())
      expect(sent.filter((request) => request.method === 'POST')).toHaveLength(0)
    })

    it('ignores a repeat while one is pending', async () => {
      const sent = conflicting(7204, { '/api/v1/runs/r1/messages': hang })
      const { result } = renderModel(run('running', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7204' }))
      await waitFor(() => expect(result.current.props.actions.resolveConflicts.enabled).toBe(true))

      act(() => {
        result.current.props.onResolveConflicts(7204)
        result.current.props.onResolveConflicts(7204)
      })
      await waitFor(() => expect(result.current.props.actions.resolveConflicts.pending).toBe(true))
      act(() => result.current.props.onResolveConflicts(7204))
      await act(() => Promise.resolve())
      expect(requestsTo(sent, '/api/v1/runs/r1/messages')).toHaveLength(1)
    })
  })

  describe('a call does nothing unless the action can run', () => {
    it('Continue: not offered on a running task, not enabled without a provider, and never twice while pending', async () => {
      const running = stubFetch()
      const live = renderModel(run('running'))
      act(() => live.result.current.props.onContinue())
      await act(() => Promise.resolve())
      expect(requestsTo(running, '/api/v1/runs/r1/continue')).toHaveLength(0)

      cleanup()
      const blocked = stubFetch({
        '/api/v1/providers/status': () => jsonResponse({ providers: [{ provider: 'claude', status: 'disconnected', enabled: true }] }),
      })
      const offline = renderModel(run('done'))
      await waitFor(() => expect(offline.result.current.props.actions.continue.reason).toBeDefined())
      act(() => offline.result.current.props.onContinue())
      await act(() => Promise.resolve())
      expect(requestsTo(blocked, '/api/v1/runs/r1/continue')).toHaveLength(0)

      cleanup()
      const pending = stubFetch({ '/api/v1/runs/r1/continue': hang })
      const busy = renderModel(run('done'))
      await waitFor(() => expect(busy.result.current.props.actions.continue.enabled).toBe(true))
      act(() => {
        busy.result.current.props.onContinue()
        busy.result.current.props.onContinue()
      })
      await waitFor(() => expect(busy.result.current.props.actions.continue).toMatchObject({ pending: true, enabled: false }))
      act(() => busy.result.current.props.onContinue())
      await act(() => Promise.resolve())
      expect(requestsTo(pending, '/api/v1/runs/r1/continue')).toHaveLength(1)
    })

    it('Stop: not offered on a finished task, and not while a stop is pending', async () => {
      stubFetch()
      const finished = renderModel(run('done'))
      act(() => finished.result.current.props.onStop())
      expect(finished.requestStopConfirmation).not.toHaveBeenCalled()

      cleanup()
      const sent = stubFetch({ '/api/v1/runs/r1/cancel': hang })
      const stopping = renderModel(run('running'))
      act(() => stopping.result.current.stopTask())
      await waitFor(() => expect(stopping.result.current.props.actions.stop).toMatchObject({ pending: true, enabled: false }))
      act(() => stopping.result.current.props.onStop())
      act(() => stopping.result.current.stopTask())
      expect(stopping.requestStopConfirmation).not.toHaveBeenCalled()
      expect(requestsTo(sent, '/api/v1/runs/r1/cancel')).toHaveLength(1)
    })

    it('Archive: not offered on an active task, and never twice while pending', async () => {
      const active = stubFetch()
      const live = renderModel(run('running'))
      act(() => live.result.current.props.onArchive())
      await act(() => Promise.resolve())
      expect(requestsTo(active, '/api/v1/runs/r1/archive')).toHaveLength(0)

      cleanup()
      const sent = stubFetch({ '/api/v1/runs/r1/archive': hang })
      const archiving = renderModel(run('done'))
      act(() => {
        archiving.result.current.props.onArchive()
        archiving.result.current.props.onArchive()
      })
      await waitFor(() => expect(archiving.result.current.props.actions.archive).toMatchObject({ pending: true, enabled: false }))
      act(() => archiving.result.current.props.onArchive())
      await act(() => Promise.resolve())
      expect(requestsTo(sent, '/api/v1/runs/r1/archive')).toHaveLength(1)
    })
  })

  // Review of #37: the header is not remounted between tasks, so task A's request in flight must
  // not disable task B's buttons.
  it('keeps a request in flight for one task from disabling the next task’s actions', async () => {
    const sent = stubFetch({ '/api/v1/runs/r1/archive': hang })
    const { result, rerender } = renderModel(run('done'))
    act(() => result.current.props.onArchive())
    await waitFor(() => expect(result.current.props.actions.archive.pending).toBe(true))

    rerender({ record: run('done', { id: 'r2' }) })
    expect(result.current.props.actions.archive).toEqual({ available: true, enabled: true, pending: false })
    act(() => result.current.props.onArchive())
    await waitFor(() => expect(requestsTo(sent, '/api/v1/runs/r2/archive')).toHaveLength(1))
  })

  describe('onNavigate', () => {
    const automated = run('done', {
      automation: { automationId: 'a-1', automationRevision: 1, receiptId: 'r-1', event: 'issue.opened', githubUrl: 'https://github.com/o/r/issues/801' },
    })

    it('navigates to the automation link its props carry', async () => {
      stubFetch({ '/api/v1/health': () => jsonResponse(HEALTH_ON) })
      const { result } = renderModel(automated, { path: '/p/web/tasks/r1' })
      await waitFor(() => expect(result.current.props.meta.automation?.href).toBe('/p/web/automations/a-1/log'))

      act(() => result.current.props.onNavigate('/p/web/automations/a-1/log'))
      expect(location).toBe('/p/web/automations/a-1/log')
    })

    it('ignores any other value, with one warning per value', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stubFetch({ '/api/v1/health': () => jsonResponse(HEALTH_ON) })
      const { result } = renderModel(automated, { path: '/p/web/tasks/r1' })
      await waitFor(() => expect(result.current.props.meta.automation?.href).toBeDefined())

      for (const href of ['javascript:void(0)', '//evil.example', '/p/web/tasks/other', 'javascript:void(0)']) {
        act(() => result.current.props.onNavigate(href))
      }
      expect(location).toBe('/p/web/tasks/r1')
      expect(warn).toHaveBeenCalledTimes(3)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[cezar:extensions\] /)
    })
  })

  describe('onChooseEngine', () => {
    it('is offered only when the page passed a picker and the task can be continued', () => {
      stubFetch()
      const chooseEngine = vi.fn()
      const withPicker = renderModel(run('done'), { options: { chooseEngine } })
      expect(withPicker.result.current.props.actions.chooseEngine).toEqual({ available: true, enabled: true, pending: false })
      act(() => withPicker.result.current.props.onChooseEngine())
      expect(chooseEngine).toHaveBeenCalledTimes(1)

      withPicker.rerender({ record: run('running'), options: { chooseEngine } })
      expect(withPicker.result.current.props.actions.chooseEngine.available).toBe(false)
      act(() => withPicker.result.current.props.onChooseEngine())
      expect(chooseEngine).toHaveBeenCalledTimes(1)

      cleanup()
      const without = renderModel(run('done'))
      expect(without.result.current.props.actions.chooseEngine.available).toBe(false)
      act(() => without.result.current.props.onChooseEngine())
    })
  })

  it('onRename opens core’s title editor', () => {
    stubFetch()
    const { result } = renderModel(run('done'))
    expect(result.current.titleEditor.editing).toBe(false)

    act(() => result.current.props.onRename())
    expect(result.current.titleEditor.editing).toBe(true)
    expect(result.current.titleEditor.draft).toBe('Do the thing')
  })
})

describe('useTaskHeaderModel: identity', () => {
  it('freezes the data and keeps it while its inputs are unchanged', async () => {
    stubFetch()
    const record = run('done', { branch: 'cez/r1', diffStat: { adds: 1, dels: 2, files: 3 } })
    const { result, rerender } = renderModel(record)
    await waitFor(() => expect(result.current.props.actions.continue.enabled).toBe(true))
    const before = result.current.props

    expect(Object.isFrozen(before)).toBe(true)
    expect(Object.isFrozen(before.task)).toBe(true)
    expect(Object.isFrozen(before.meta.diff)).toBe(true)
    expect(Object.isFrozen(before.actions.continue)).toBe(true)

    rerender({ record })
    rerender({ record: { ...record } })
    expect(result.current.props).toBe(before)
  })

  it('makes new data for the same run when its queue position or a reference’s look-up changes', async () => {
    let queue = [run('queued', { id: 'r0', createdAt: '2026-07-14T11:00:00.000Z' }), run('queued', { id: 'r1' })]
    let conflicts: number[] = []
    stubFetch({
      '/api/v1/runs': () => jsonResponse(queue),
      '/api/v1/health': () => jsonResponse({ bootProject: 'acme' }),
      '/api/v1/p/acme/github/ref-status?prs=7301': () =>
        jsonResponse({ available: true, prs: { 7301: 'ready' }, issues: {}, conflicts, recheckAfterMs: null }),
    })
    const client = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(CommandsProvider, null, createElement(MemoryRouter, { initialEntries: ['/tasks/r1'] }, children)),
      )
    const record = run('queued', { referencedPullRequestUrl: 'https://github.com/o/r/pull/7301' })
    const { result } = renderHook(() => useTaskHeaderModel(record, { requestStopConfirmation: () => {} }), { wrapper })
    await waitFor(() => expect(result.current.props.attention.queuePosition).toBe(2))
    await waitFor(() => expect(result.current.props.meta.references?.[0]?.lookup).toBe('ready'))
    const queued = result.current.props

    queue = [run('queued', { id: 'r1' })]
    await act(() => client.invalidateQueries())
    await waitFor(() => expect(result.current.props.attention.queuePosition).toBe(1))
    expect(result.current.props).not.toBe(queued)
    const moved = result.current.props

    conflicts = [7301]
    await act(() => client.invalidateQueries())
    await waitFor(() => expect(result.current.props.meta.references?.[0]?.conflicting).toBe(true))
    expect(result.current.props).not.toBe(moved)
  })

  it('keeps every callback’s identity, and acts on the task the header shows now', async () => {
    const sent = stubFetch()
    const { result, rerender, requestStopConfirmation } = renderModel(run('done'))
    const first = result.current
    const callbacks = [
      first.props.onContinue, first.props.onStop, first.props.onArchive, first.props.onRename,
      first.props.onResolveConflicts, first.props.onNavigate, first.props.onChooseEngine, first.stopTask,
    ]

    // Task B, in the same header: the route swaps the run without remounting.
    rerender({ record: run('done', { id: 'r2' }) })
    const second = result.current
    expect([
      second.props.onContinue, second.props.onStop, second.props.onArchive, second.props.onRename,
      second.props.onResolveConflicts, second.props.onNavigate, second.props.onChooseEngine, second.stopTask,
    ]).toEqual(callbacks)

    await waitFor(() => expect(result.current.props.actions.continue.enabled).toBe(true))
    act(() => first.props.onContinue())
    act(() => first.props.onArchive())
    act(() => first.stopTask())
    await waitFor(() => {
      expect(requestsTo(sent, '/api/v1/runs/r2/continue')).toHaveLength(1)
      expect(requestsTo(sent, '/api/v1/runs/r2/archive')).toHaveLength(1)
      expect(requestsTo(sent, '/api/v1/runs/r2/cancel')).toHaveLength(1)
    })
    expect(sent.some((request) => request.method === 'POST' && request.path.startsWith('/api/v1/runs/r1/'))).toBe(false)

    rerender({ record: run('running', { id: 'r2' }) })
    act(() => first.props.onStop())
    expect(requestStopConfirmation).toHaveBeenCalledTimes(1)
  })
})
