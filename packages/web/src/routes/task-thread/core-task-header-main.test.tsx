import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import type { TaskHeaderMainProps, TaskMetadataProps } from '@open-mercato/cezar-extension-api'
import { ReferenceChip } from '@/components/reference-chip'
import { ReferenceStatusProvider } from '@/components/reference-status'

import { CoreTaskHeaderMain } from './core-task-header-main'
import { CoreTaskMetadata } from './core-task-metadata'

beforeEach(() => {
  // Radix's tooltip arrow measures itself with a ResizeObserver; jsdom has no layout observer.
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
  vi.unstubAllGlobals()
})

const idle = { available: false, enabled: false, pending: false }

/** A header's props as core builds them, with every intent a spy. */
function headerProps(extra: Partial<TaskHeaderMainProps> = {}): TaskHeaderMainProps {
  return {
    task: {
      taskId: 'r1',
      projectId: 'acme',
      title: 'Do the thing',
      prompt: 'Summarize what this project does.',
      status: 'queued',
      archived: false,
    },
    attention: { label: 'queued', tone: 'neutral', pulse: false, queuePosition: 2 },
    engine: { runner: 'claude', model: 'opus', account: 'Klaudiusz', identity: 'anthropic/claude-opus-4-8' },
    meta: {
      workflow: 'quick-task',
      branch: 'cez/r1',
      diff: { added: 12, removed: 3, files: 4 },
      references: [
        { kind: 'pr', number: 534, url: 'https://github.com/o/r/pull/534', status: 'ready', lookup: 'ready', conflicting: true },
        { kind: 'pr', number: 535, url: 'https://github.com/o/r/pull/535', lookup: 'loading' },
        {
          kind: 'pr',
          number: 536,
          url: 'https://github.com/o/r/pull/536',
          status: 'checks-failing',
          lookup: 'unavailable',
          lookupReason: 'gh CLI not found',
        },
        { kind: 'issue', number: 544, url: 'https://github.com/o/r/issues/544', status: 'open', lookup: 'ready' },
      ],
      automation: { automationId: 'a-1', href: '/p/acme/automations/a-1/log' },
      usage: { inputTokens: 24_600, outputTokens: 2_400, costUsd: 0.04 },
    },
    plan: { done: 2, total: 5 },
    actions: {
      continue: idle,
      stop: { available: true, enabled: true, pending: false },
      archive: idle,
      resolveConflicts: { available: true, enabled: true, pending: false },
      chooseEngine: { available: true, enabled: true, pending: false },
    },
    onContinue: vi.fn(),
    onStop: vi.fn(),
    onArchive: vi.fn(),
    onRename: vi.fn(),
    onResolveConflicts: vi.fn(),
    onNavigate: vi.fn(),
    onChooseEngine: vi.fn(),
    ...extra,
  }
}

function metadataProps(props: TaskHeaderMainProps): TaskMetadataProps {
  return {
    task: { id: props.task.taskId, projectId: props.task.projectId, title: props.task.title },
    metadata: { ...props.meta, engine: props.engine },
    actions: { resolveConflicts: props.actions.resolveConflicts, chooseEngine: props.actions.chooseEngine },
    intents: {
      resolveConflicts: props.onResolveConflicts,
      navigate: props.onNavigate,
      chooseEngine: props.onChooseEngine,
    },
  }
}

function RenderedHeader(props: TaskHeaderMainProps) {
  return <><CoreTaskHeaderMain {...props} /><CoreTaskMetadata {...metadataProps(props)} /></>
}

const meta = () => document.querySelector('[data-slot="run-meta"]') as HTMLElement
const chip = (number: number) => meta().querySelector(`[href$="/${number}"]`) as HTMLElement
const panelText = () => document.querySelector('[data-slot="reference-status-card"]')?.textContent ?? ''

async function openAgentMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(within(meta()).getByRole('button', { name: /^Agent:/ }), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return screen.findByRole('menu')
}

describe('CoreTaskHeaderMain, from its props alone', () => {
  // No QueryClientProvider, router, CommandsProvider or ComponentsProvider above it: anything it
  // reached for beyond its props would throw here.
  it('renders the title row with the prompt as its hover text, the pill and the plan mirror', () => {
    render(<RenderedHeader {...headerProps()} />)

    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('Do the thing')
    expect(title.getAttribute('title')).toBe('Summarize what this project does.')
    expect(document.querySelector('[data-slot="pill"]')?.textContent).toBe('queued #2')
    expect(document.querySelector('[data-slot="plan-mirror"]')?.textContent).toBe('Plan 2/5')
  })

  it('reads a tone it does not know as neutral', () => {
    render(<RenderedHeader {...headerProps({ attention: { label: 'thinking', tone: 'ultraviolet', pulse: true } })} />)

    const dot = document.querySelector('[data-slot="pill"] [data-slot="status-dot"]') as HTMLElement
    expect(dot.className).toContain('bg-soft-foreground')
  })

  it('renders the meta row: workflow, branch, the chips, the diff, the automation link and usage', () => {
    render(<RenderedHeader {...headerProps()} />)
    const row = meta()

    expect(row.textContent).toContain('quick-task')
    expect(row.querySelector('[data-slot="branch-chip"]')?.textContent).toContain('cez/r1')
    expect([...row.querySelectorAll('[data-slot="pr-chip"]')].map((pr) => pr.textContent)).toEqual([
      expect.stringContaining('#534'),
      expect.stringContaining('#535'),
      expect.stringContaining('#536'),
    ])
    expect(chip(534).getAttribute('data-status')).toBe('ready')
    expect(chip(534).getAttribute('data-conflicting')).toBe('true')
    expect(chip(536).getAttribute('data-status')).toBe('checks-failing')
    expect(row.querySelector('[data-slot="issue-chip"]')?.textContent).toContain('Issue #544')
    expect(row.querySelector('[data-slot="diff-stat"]')?.getAttribute('title')).toBe('+12 −3 across 4 files')
    expect(within(row).getByRole('link', { name: 'Automation' }).getAttribute('href')).toBe('/p/acme/automations/a-1/log')
    expect(row.textContent).toContain('$0.04')
    expect(row.textContent).toContain('24.6k')
  })

  it('says what a look-up is doing when there is no status to show, and dates a remembered one', async () => {
    render(<RenderedHeader {...headerProps()} />)

    fireEvent.focus(chip(535))
    await waitFor(() => expect(panelText()).toContain('Checking GitHub…'))
    fireEvent.blur(chip(535))
    fireEvent.focus(chip(536))
    await waitFor(() => expect(panelText()).toContain('last known — GitHub is unreachable (gh CLI not found)'))
  })

  it('shows the repointed caveat on the diff', () => {
    render(<RenderedHeader {...headerProps({ meta: { workflow: 'review', diff: { added: 1, removed: 2, files: 1, repointed: true } } })} />)

    const diff = meta().querySelector('[data-slot="diff-stat"]') as HTMLElement
    expect(diff.getAttribute('data-repointed')).toBe('true')
    expect(diff.getAttribute('aria-label')).toMatch(/^\+1 −2 across 1 file — measured against another branch/)
  })

  it('leaves out what the props do not carry', () => {
    render(<RenderedHeader {...headerProps({ meta: { workflow: 'quick-task' }, plan: undefined })} />)
    const row = meta()

    expect(row.querySelector('[data-slot="branch-chip"], [data-slot="pr-chip"], [data-slot="diff-stat"]')).toBeNull()
    expect(row.textContent).not.toContain('$')
    expect(row.textContent).not.toContain('Automation')
    expect(document.querySelector('[data-slot="plan-mirror"]')).toBeNull()
  })

  it('degrades the automation chip to text without an href', () => {
    render(<RenderedHeader {...headerProps({ meta: { workflow: 'quick-task', automation: { automationId: 'a-1' } } })} />)

    expect(meta().querySelector('[data-slot="automation-origin"]')?.textContent).toBe('Automation')
    expect(within(meta()).queryByRole('link', { name: 'Automation' })).toBeNull()
  })

  it('shows the engine in the badge, with the breakdown and the identity in its menu', async () => {
    render(<RenderedHeader {...headerProps()} />)

    const badge = within(meta()).getByRole('button', { name: 'Agent: claude, account Klaudiusz, model opus' })
    expect(badge.querySelector('[data-slot="agent-badge-summary"]')?.textContent).toBe('claude · Klaudiusz · opus')
    const menu = await openAgentMenu()
    expect(menu.textContent).toContain('runner: claude')
    expect(menu.querySelector('[data-slot="agent-badge-account"]')?.textContent).toBe('account: Klaudiusz')
    expect(menu.textContent).toContain('model: opus')
    expect(menu.querySelector('[data-slot="agent-badge-identity"]')?.textContent).toBe('identity: anthropic/claude-opus-4-8')
    // The inline picker is gone from the badge (spec Q7): the dock holds it.
    expect(menu.querySelector('[data-slot="agent-badge-engine-picker"]')).toBeNull()
  })
})

describe('CoreTaskHeaderMain, its intents', () => {
  it('the pencil asks core to rename', () => {
    const props = headerProps()
    render(<RenderedHeader {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    expect(props.onRename).toHaveBeenCalledTimes(1)
  })

  it('Resolve conflicts asks for the conflicting PR, and the panel closes when the request settles', async () => {
    const props = headerProps()
    const { rerender } = render(<RenderedHeader {...props} />)

    fireEvent.focus(chip(534))
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve conflicts' }))
    expect(props.onResolveConflicts).toHaveBeenCalledWith(534)

    const pending = { available: true, enabled: false, pending: true }
    rerender(<RenderedHeader {...props} actions={{ ...props.actions, resolveConflicts: pending }} />)
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<RenderedHeader {...props} />)
    await waitFor(() => expect(document.querySelector('[data-slot="reference-status-card"]')).toBeNull())
  })

  // Review of #37: another chip's request settling must not close a card the user did not press.
  it('keeps a card open when a request it did not send settles', async () => {
    const props = headerProps()
    const { rerender } = render(<RenderedHeader {...props} />)
    fireEvent.focus(chip(534))
    await screen.findByRole('button', { name: 'Resolve conflicts' })

    const pending = { available: true, enabled: false, pending: true }
    rerender(<RenderedHeader {...props} actions={{ ...props.actions, resolveConflicts: pending }} />)
    rerender(<RenderedHeader {...props} />)
    expect(document.querySelector('[data-slot="reference-status-card"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Resolve conflicts' })).not.toBeNull()
  })

  it('offers no Resolve conflicts while the action is not offered, and explains a refusal', async () => {
    const props = headerProps()
    const { rerender } = render(<RenderedHeader {...props} actions={{ ...props.actions, resolveConflicts: idle }} />)
    fireEvent.focus(chip(534))
    await waitFor(() => expect(panelText()).toContain('Pull request #534'))
    expect(screen.queryByRole('button', { name: 'Resolve conflicts' })).toBeNull()

    const refused = { available: true, enabled: false, pending: false, reason: 'Connect an agent provider to continue.' }
    rerender(<RenderedHeader {...props} actions={{ ...props.actions, resolveConflicts: refused }} />)
    expect((screen.getByRole('button', { name: 'Resolve conflicts' }) as HTMLButtonElement).disabled).toBe(true)
    expect(panelText()).toContain('Connect an agent provider to continue.')
  })

  it('a plain click on the automation link asks core to navigate; a modified one does not', () => {
    const props = headerProps()
    render(<RenderedHeader {...props} />)
    const link = within(meta()).getByRole('link', { name: 'Automation' })

    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    fireEvent.click(link, { button: 1 })
    expect(props.onNavigate).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(props.onNavigate).toHaveBeenCalledWith('/p/acme/automations/a-1/log')
  })

  it('the badge menu offers the engine picker for the next continuation', async () => {
    const props = headerProps()
    render(<RenderedHeader {...props} />)

    const menu = await openAgentMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Choose engine for the next continuation…' }))
    await waitFor(() => expect(props.onChooseEngine).toHaveBeenCalledTimes(1))
  })

  it('the badge menu has no engine item while choosing one is not offered', async () => {
    const props = headerProps()
    render(<RenderedHeader {...props} actions={{ ...props.actions, chooseEngine: idle }} />)

    const menu = await openAgentMenu()
    expect(within(menu).queryByRole('menuitem')).toBeNull()
  })
})

describe('CoreTaskHeaderMain under a status provider', () => {
  it('shows the props’ status and conflict flag, whatever the provider answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/github/ref-status')
          ? new Response(
              JSON.stringify({ available: true, prs: { 534: 'merged', 536: 'merged' }, issues: {}, conflicts: [536], recheckAfterMs: null }),
              { headers: { 'content-type': 'application/json' } },
            )
          : new Response('{}', { headers: { 'content-type': 'application/json' } }),
      ),
    )
    const requests = [534, 536].map((number) => ({ projectId: 'acme', kind: 'PR' as const, number }))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ReferenceStatusProvider projectId="acme" requests={requests}>
          <div data-slot="control">
            <ReferenceChip reference={{ kind: 'PR', number: 534, url: 'https://github.com/o/r/pull/534' }} taskTitle="control" />
          </div>
          <RenderedHeader {...headerProps()} />
        </ReferenceStatusProvider>
      </QueryClientProvider>,
    )

    // The provider has answered: a chip that reads it says `merged`.
    await waitFor(() =>
      expect(document.querySelector('[data-slot="control"] [data-slot="pr-chip"]')?.getAttribute('data-status')).toBe('merged'),
    )
    expect(chip(534).getAttribute('data-status')).toBe('ready')
    expect(chip(534).getAttribute('data-conflicting')).toBe('true')
    expect(chip(536).getAttribute('data-status')).toBe('checks-failing')
    expect(chip(536).getAttribute('data-conflicting')).toBeNull()
  })
})
