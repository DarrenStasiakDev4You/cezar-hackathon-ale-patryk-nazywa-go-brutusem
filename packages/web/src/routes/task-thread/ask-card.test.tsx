import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import { AskCard } from './ask-card'
import type { ThreadAsk } from './thread-state'
import type { ApiRun, ProviderStatusResponse, StepState } from '@open-mercato/cezar-api-client'

const mutateAsync = vi.fn().mockResolvedValue({})
let providerStatus: ProviderStatusResponse
vi.mock('@/api/queries', async (importOriginal) => ({
  // The real module otherwise: the continue command's handler reads its cache keys from it.
  ...(await importOriginal<typeof import('@/api/queries')>()),
  useSendMessage: () => ({ mutateAsync, isPending: false }),
  useProviderStatus: () => ({ data: providerStatus, isSuccess: true }),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The bodies of every `POST /continue` — the resume runs through `cezar.task.continue`, so
 *  it is the stubbed server, not a mocked hook, that sees it. */
let continues: unknown[]
/** Queued answers for the next `POST /continue`s; an empty queue accepts. */
let continueAnswers: Array<() => Response | Promise<Response>>

beforeEach(() => {
  continues = []
  continueAnswers = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'POST' && String(input) === '/api/v1/runs/r1/continue') {
        continues.push(JSON.parse(String(init.body)))
        return continueAnswers.shift()?.() ?? json({ continued: true })
      }
      return json({})
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mutateAsync.mockClear().mockResolvedValue({})
  providerStatus = {
    providers: [
      { provider: 'claude', status: 'connected', enabled: true },
      { provider: 'codex', status: 'not-installed', enabled: true },
      { provider: 'opencode', status: 'not-installed', enabled: true },
    ],
  }
})

const activeRun: ApiRun = {
  id: 'r1',
  title: 'Task',
  workflow: 'quick-task',
  task: 'Task',
  status: 'waiting',
  createdAt: '2026-07-24T00:00:00.000Z',
  tokensUsed: 0,
  archived: false,
  runner: 'claude',
  steps: [],
}

const step = (extra: Partial<StepState> = {}): StepState => ({
  id: 'task',
  name: 'Do the task',
  kind: 'agent',
  status: 'done',
  iterations: 1,
  tokensUsed: 0,
  ...extra,
})

/** The run the feature exists for: the session closed while the question was unanswered. */
const closedRun: ApiRun = {
  ...activeRun,
  status: 'done',
  steps: [step({ sessionId: 'sess-1' })],
}

const renderAsk = (ask: ThreadAsk, run: ApiRun = activeRun) => render(
  <QueryClientProvider client={createQueryClient()}>
    <CommandsProvider>
      <MemoryRouter>
        <AskCard ask={ask} run={run} />
      </MemoryRouter>
    </CommandsProvider>
  </QueryClientProvider>,
)

const singleAsk: ThreadAsk = {
  kind: 'ask',
  id: 'ask_1',
  resolved: false,
  questions: [
    {
      header: 'Library',
      question: 'Which date library should I standardize on?',
      options: [
        { label: 'date-fns', description: 'Tree-shakeable' },
        { label: 'Luxon', description: 'Immutable, tz-aware' },
      ],
    },
  ],
}

const multiAsk: ThreadAsk = {
  kind: 'ask',
  id: 'ask_2',
  resolved: false,
  questions: [
    {
      header: 'Sections',
      question: 'Which settings sections?',
      multiSelect: true,
      options: [{ label: 'Profile' }, { label: 'Appearance' }, { label: 'Billing' }],
    },
  ],
}

const twoQuestionAsk: ThreadAsk = {
  kind: 'ask',
  id: 'ask_3',
  resolved: false,
  questions: [
    {
      header: 'Library',
      question: 'Which library?',
      options: [{ label: 'date-fns' }, { label: 'Luxon' }],
    },
    {
      header: 'Style',
      question: 'Which style?',
      options: [{ label: 'ISO' }, { label: 'Relative' }],
    },
  ],
}

describe('AskCard', () => {
  it('renders the header, question and each option with its description', () => {
    renderAsk(singleAsk)
    expect(screen.getByText('Library')).toBeTruthy()
    expect(screen.getByText('Which date library should I standardize on?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /date-fns/ })).toBeTruthy()
    expect(screen.getByText('Tree-shakeable')).toBeTruthy()
  })

  it('wraps schema-valid unbroken question and option text inside the card', () => {
    const question = 'q'.repeat(400)
    const label = 'l'.repeat(60)
    const description = 'd'.repeat(280)
    renderAsk({
      ...singleAsk,
      questions: [{ header: 'Limits', question, options: [{ label, description }, { label: 'Other' }] }],
    })

    expect(screen.getByText(question).className).toContain('break-words')
    expect(screen.getByText(label).className).toContain('break-words')
    expect(screen.getByText(description).className).toContain('break-words')
  })

  it('a single single-select question sends "header: label" on one tap (no Send button)', () => {
    renderAsk(singleAsk)
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    expect(mutateAsync).toHaveBeenCalledWith({ text: 'Library: date-fns' })
  })

  it('multiple questions: one Send posts every answer in one combined message', () => {
    renderAsk(twoQuestionAsk)
    const send = screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement
    // Answering only the first question does NOT send, and does not resolve.
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    expect(send.disabled).toBe(true)
    expect(mutateAsync).not.toHaveBeenCalled()
    // Both answered → one combined message.
    fireEvent.click(screen.getByRole('button', { name: /Relative/ }))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({ text: 'Library: date-fns\nStyle: Relative' })
  })

  it('multi-select: Send is disabled until options are picked, then sends the comma-joined labels', () => {
    renderAsk(multiAsk)
    const send = screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Profile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Billing/ }))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(mutateAsync).toHaveBeenCalledWith({ text: 'Sections: Profile, Billing' })
  })

  it('a resolved ask collapses to a compact answered summary with no option buttons', () => {
    renderAsk({ ...singleAsk, resolved: true, answer: 'Library: date-fns' })
    expect(screen.getByText('Answered')).toBeTruthy()
    expect(screen.getByText('Library: date-fns').className).toContain('break-words')
    expect(screen.queryByRole('button', { name: /date-fns/ })).toBeNull()
  })

  it.each([
    ['disabled', { provider: 'claude', status: 'connected', enabled: false }, 'Claude Code is disabled. Enable it in Settings → Agents → Providers.'],
    ['disconnected', { provider: 'claude', status: 'disconnected', enabled: true }, 'Claude Code credentials are unavailable. Authorize it in Settings → Agents → Providers.'],
  ] as const)('disables Ask submissions when its active provider is %s', (_case, claude, reason) => {
    providerStatus = {
      providers: [
        claude,
        { provider: 'codex', status: 'connected', enabled: true },
        { provider: 'opencode', status: 'not-installed', enabled: true },
      ],
    }

    renderAsk(singleAsk)

    expect((screen.getByRole('button', { name: /date-fns/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Configure providers' }).getAttribute('href')).toBe(
      '/settings/agents#providers',
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})

// The question outlives its session: an idle timeout, a cezar restart, Finish or a cancel
// closes the session with the card still unanswered. Before this, every tap posted to
// `POST /messages` and died on its `409 session closed` — silently.
describe('AskCard — answering after the session has ended', () => {
  it('a closed run resumes instead of replying, with the same answer text', async () => {
    renderAsk(singleAsk, closedRun)
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    await waitFor(() => expect(continues).toHaveLength(1))
    // No runner override: answering a question must not silently switch the run's engine.
    expect(continues).toEqual([{ text: 'Library: date-fns' }])
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('says the session reopens, on both the one-tap and the combined-Send shapes', () => {
    const { unmount } = renderAsk(singleAsk, closedRun)
    expect(screen.getByText('The session has ended — your answer reopens it and goes to the agent.')).toBeTruthy()
    unmount()
    renderAsk(twoQuestionAsk, closedRun)
    expect(screen.getByRole('button', { name: 'Send answer & reopen' })).toBeTruthy()
    expect(screen.getByText('the session has ended — sending reopens it')).toBeTruthy()
  })

  // The resume affordance must be identifiable without reading copy — and must NOT be claimed
  // by a live run's ordinary "pick one or more" hint, which sits in the same slot position.
  it('marks the delivery seam on the card, and only names the resume hint when resuming', () => {
    const { unmount } = renderAsk(twoQuestionAsk, activeRun)
    expect(document.querySelector('[data-slot="ask-card"]')?.getAttribute('data-delivery')).toBe('live')
    expect(document.querySelector('[data-slot="ask-resume-hint"]')).toBeNull()
    expect(document.querySelector('[data-slot="ask-hint"]')).toBeTruthy()
    unmount()
    renderAsk(twoQuestionAsk, closedRun)
    expect(document.querySelector('[data-slot="ask-card"]')?.getAttribute('data-delivery')).toBe('resume')
    expect(document.querySelector('[data-slot="ask-resume-hint"]')).toBeTruthy()
  })

  it('combined Send on a closed run resumes once with every answer', async () => {
    renderAsk(twoQuestionAsk, closedRun)
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    fireEvent.click(screen.getByRole('button', { name: /Relative/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send answer & reopen' }))
    await waitFor(() => expect(continues).toHaveLength(1))
    expect(continues).toEqual([{ text: 'Library: date-fns\nStyle: Relative' }])
  })

  it('a stale record that still claims a live session falls back to a resume on 409', async () => {
    // The cockpit's cached record says `waiting`; the server has already closed the session.
    mutateAsync.mockRejectedValueOnce(new ApiError(409, 'session closed'))
    renderAsk(singleAsk, { ...activeRun, steps: [step({ sessionId: 'sess-1' })] })
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    await waitFor(() => expect(continues).toHaveLength(1))
    expect(continues).toEqual([{ text: 'Library: date-fns' }])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('waits for idle teardown before retrying the continuation, without accepting a duplicate tap', async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(409, 'session closed'))
    let resolveContinuation: (() => void) | undefined
    continueAnswers.push(
      () => json({ error: 'run is still active' }, 409),
      () =>
        new Promise<Response>((resolve) => {
          resolveContinuation = () => resolve(json({ continued: true }))
        }),
    )
    renderAsk(singleAsk, { ...activeRun, steps: [step({ sessionId: 'sess-1' })] })

    const option = screen.getByRole('button', { name: /date-fns/ })
    fireEvent.click(option)
    await waitFor(() => expect(continues).toHaveLength(1))
    expect((option as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(option)

    await waitFor(() => expect(continues).toHaveLength(2))
    expect(continues).toEqual([{ text: 'Library: date-fns' }, { text: 'Library: date-fns' }])
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    resolveContinuation?.()
    await waitFor(() => expect((option as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not silently switch to another connected provider when the run provider is unavailable', () => {
    providerStatus = {
      providers: [
        { provider: 'claude', status: 'disconnected', enabled: true },
        { provider: 'codex', status: 'connected', enabled: true },
        { provider: 'opencode', status: 'not-installed', enabled: true },
      ],
    }

    renderAsk(singleAsk, closedRun)

    expect((screen.getByRole('button', { name: /date-fns/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText(
        'Claude Code credentials are unavailable. Authorize it in Settings → Agents → Providers.',
      ),
    ).toBeTruthy()
    expect(continues).toEqual([])
  })

  it('a refused delivery is shown on the card instead of being dropped', async () => {
    continueAnswers.push(() => json({ error: 'no agent session to resume' }, 409))
    renderAsk(singleAsk, closedRun)
    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('no agent session to resume')
  })

  it('a closed run that never recorded a session says so and stays inert', () => {
    renderAsk(singleAsk, { ...closedRun, steps: [step()] })
    expect((screen.getByRole('button', { name: /date-fns/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText(
        'This session has ended and no agent session was recorded, so the answer cannot be delivered.',
      ),
    ).toBeTruthy()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(continues).toEqual([])
  })
})
