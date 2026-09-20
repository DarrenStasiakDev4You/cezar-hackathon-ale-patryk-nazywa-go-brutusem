import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { ComponentsProvider } from '@/component-registry/provider'
import { fakeScope } from '@/extensions/registry.fixtures'
import type { ApiRun, RunEvent } from '@open-mercato/cezar-api-client'
import { TaskComposer } from '@open-mercato/cezar-extension-api'

import plain from '../../../../extension-api/examples/plain-task-composer/index.ts'
import { ThreadView } from './task-thread'
import { reduceThread } from './thread-state'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const run = (status: ApiRun['status']): ApiRun => ({
  id: 'r1',
  title: 'plain composer task',
  titleSummary: 'Plain composer task',
  workflow: 'quick-task',
  task: 'Say hello',
  status,
  createdAt: '2026-09-19T12:00:00.000Z',
  tokensUsed: 0,
  archived: false,
  steps: [],
})

describe('external Task Composer on the task page', () => {
  it('activates and renders the package-only implementation through the real host', async () => {
    const registry = createCoreComponentRegistry()
    const fake = fakeScope('example.plain-composer')
    const recorded: { contract?: unknown; implementation?: unknown } = {}
    const context = {
      components: {
        provide(contract: unknown, implementation: unknown) {
          recorded.contract = contract
          recorded.implementation = implementation
        },
      },
    }
    await plain.activate(context as never)
    registry.forExtension(fake.scope).provide(recorded.contract as never, recorded.implementation as never)

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const body = path.includes('/providers/status')
        ? { providers: [{ provider: 'claude', status: 'connected', enabled: true }] }
        : path.includes('/drafts')
          ? { surfaces: {} }
          : path.includes('/messages') && init?.method === 'POST'
            ? { ...run('waiting'), status: 'waiting' }
            : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CommandsProvider>
          <ComponentsProvider
            registry={registry}
            preferenceOf={(contractId) => (contractId === TaskComposer.id ? 'example.plain-composer.box' : null)}
          >
            <MemoryRouter>
              <ThreadView run={run('waiting')} thread={reduceThread([] as RunEvent[])} />
            </MemoryRouter>
          </ComponentsProvider>
        </CommandsProvider>
      </QueryClientProvider>,
    )

    const textarea = await screen.findByLabelText('Reply to the agent')
    expect(document.querySelector('[data-slot="plain-task-composer"]')).toBeTruthy()
    fireEvent.change(textarea, { target: { value: 'hello from outside web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(textarea).toHaveProperty('value', ''))
  })
})
