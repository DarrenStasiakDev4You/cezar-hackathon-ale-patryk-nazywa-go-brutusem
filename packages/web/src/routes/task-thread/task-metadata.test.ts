import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { CommandsProvider } from '@/commands/provider'
import type { ApiRun, RunStatus, StepState } from '@open-mercato/cezar-api-client'

import { useTaskMetadataController } from './task-metadata'

const step = (): StepState => ({
  id: 'step-1',
  name: 'Do the task',
  kind: 'agent',
  status: 'done',
  iterations: 1,
  tokensUsed: 10,
  sessionId: 'session-1',
})

const run = (status: RunStatus = 'done'): ApiRun => ({
  id: 'r1',
  title: 'Do the thing',
  titleSummary: 'Do the thing',
  workflow: 'quick-task',
  task: 'Summarize the project.',
  status,
  createdAt: '2026-09-19T12:00:00.000Z',
  branch: 'cez/r1',
  diffStat: { adds: 2, dels: 1, files: 1 },
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  archived: false,
  steps: [step()],
})

const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderMetadata(record: ApiRun, chooseEngine?: () => void) {
  vi.stubGlobal('fetch', vi.fn(async () => response({})))
  const client = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, createElement(CommandsProvider, null, createElement(MemoryRouter, null, children)))
  return renderHook(() => useTaskMetadataController(record, { chooseEngine }), { wrapper })
}

describe('useTaskMetadataController', () => {
  it('builds the public task metadata model from the run', () => {
    const { result } = renderMetadata(run())

    expect(result.current.task).toEqual({ id: 'r1', projectId: '', title: 'Do the thing' })
    expect(result.current.metadata).toMatchObject({
      workflow: 'quick-task',
      branch: 'cez/r1',
      diff: { added: 2, removed: 1, files: 1 },
      engine: { runner: 'claude', model: 'auto' },
    })
    expect(result.current.actions.chooseEngine.available).toBe(false)
    expect(Object.isFrozen(result.current.metadata)).toBe(true)
    expect(Object.isFrozen(result.current.metadata.diff)).toBe(true)
  })

  it('keeps intents stable and enables engine selection only when offered', () => {
    const chooseEngine = vi.fn()
    const { result, rerender } = renderMetadata(run(), chooseEngine)
    const intents = result.current.intents

    expect(result.current.actions.chooseEngine).toEqual({ available: true, enabled: true, pending: false })
    result.current.intents.chooseEngine?.()
    expect(chooseEngine).toHaveBeenCalledOnce()

    rerender()
    expect(result.current.intents).toBe(intents)
  })
})
