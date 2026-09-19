import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectChanged,
  TaskStatusChanged,
  type ProjectChange,
  type TaskTransition,
} from '@open-mercato/cezar-extension-api'
import type { ProjectsResponse } from '@open-mercato/cezar-api-client'

import { queryKeys, workspaceQueryKeys } from './api/queries'
import { createQueryClient } from './api/query-client'
import { App } from './app'
import { createEventBus } from './events/bus'

/**
 * The page-level wiring of spec `2026-09-19-extension-event-api`: `main.tsx` hands `App` the bus
 * the extension host uses, and both core event sources inside the tree — the stream relay and the
 * project reporter — must emit on THAT bus. Without this test, dropping `events={…}` or the
 * reporter's mount would leave every unit test green while extensions heard nothing.
 */

/** Just enough of an EventSource for `useGlobalEvents`: listeners, and a lever to emit a frame. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 1
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(name: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(listener)
    this.listeners.set(name, set)
  }
  removeEventListener(name: string, listener: (event: Event) => void): void {
    this.listeners.get(name)?.delete(listener)
  }
  close(): void {
    this.readyState = 2
  }
  emit(name: string, data: string): void {
    act(() => {
      for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data }))
    })
  }
}

const BOOT = 'boot'
/** A full-enough `/api/v1/health` answer — the same shape `routes.test.tsx` seeds. */
const HEALTH = {
  version: '0.0.0-test',
  repoRoot: '/r/boot',
  repo: null,
  checks: [],
  defaultRunner: 'claude',
  forge: null,
  capabilities: { localHandoff: true, followups: true, singleProject: false, automations: false },
  projects: [{ id: BOOT, name: 'boot' }],
  bootProject: BOOT,
}
const REGISTRY: ProjectsResponse = {
  projects: [{ id: BOOT, name: 'boot', root: '/r/boot', addedAt: '', lastOpenedAt: '', source: 'local', status: 'ok' }],
  bootProject: BOOT,
  projectsDir: '~/cezar/projects',
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  // Every answer the test needs is seeded; anything else stays pending rather than failing.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})))
  window.history.replaceState(null, '', `/p/${BOOT}/`)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('App and the page’s event bus', () => {
  it('relays the stream’s task transitions and reports the shown project on the bus it was given', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.health, HEALTH)
    queryClient.setQueryData(workspaceQueryKeys.projects, REGISTRY)
    queryClient.setQueryData(workspaceQueryKeys.uiState, {})
    const bus = createEventBus()
    const transitions: TaskTransition[] = []
    const projects: ProjectChange[] = []
    bus.on(TaskStatusChanged, (task) => transitions.push(task))
    bus.on(ProjectChanged, (change) => projects.push(change))

    render(<App queryClient={queryClient} events={bus} />)

    await waitFor(() => expect(projects).toEqual([{ projectId: BOOT, previousProjectId: null }]))
    const source = FakeEventSource.instances.at(-1)
    expect(source?.url).toBe('/api/v1/workspace/events')
    source?.emit(
      'task-transition',
      JSON.stringify({ project: 'other', id: 'r1', status: 'failed', previousStatus: 'running', archived: false, previousArchived: false }),
    )
    await waitFor(() =>
      expect(transitions).toEqual([{ taskId: 'r1', projectId: 'other', status: 'failed', previousStatus: 'running' }]),
    )
  })
})
