import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectChanged, type ProjectChange } from '@open-mercato/cezar-extension-api'
import type { ProjectsResponse } from '@open-mercato/cezar-api-client'

import { workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'

import { createEventBus } from './bus'
import { ProjectChangeReporter, shownProject } from './project-change-reporter'
import { EventBusProvider } from './provider'

const REGISTRY: ProjectsResponse = {
  projects: [
    { id: 'a', name: 'a', root: '/r/a', addedAt: '', lastOpenedAt: '', source: 'local', status: 'ok' },
    { id: 'b', name: 'b', root: '/r/b', addedAt: '', lastOpenedAt: '', source: 'local', status: 'ok' },
  ],
  bootProject: 'a',
  projectsDir: '~/cezar/projects',
}

beforeEach(() => {
  // Every answer this file needs is seeded; a fetch that never settles keeps anything else pending.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

let navigate: NavigateFunction = () => {}
function NavigateLever() {
  navigate = useNavigate()
  return null
}

/** The reporter under a router at `entry`, with its bus, and every change it emits. */
async function renderReporter(entry: string, options: { registry?: ProjectsResponse | null; strict?: boolean } = {}) {
  const client = createQueryClient()
  if (options.registry !== null) client.setQueryData(workspaceQueryKeys.projects, options.registry ?? REGISTRY)
  const bus = createEventBus()
  const heard: ProjectChange[] = []
  bus.on(ProjectChanged, (change) => heard.push(change))
  const tree: ReactNode = (
    <QueryClientProvider client={client}>
      <EventBusProvider bus={bus}>
        <MemoryRouter initialEntries={[entry]}>
          <ProjectChangeReporter />
          <NavigateLever />
        </MemoryRouter>
      </EventBusProvider>
    </QueryClientProvider>
  )
  render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  await settle()
  return { heard, client }
}

/** Effects have run and the bus has delivered. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function go(path: string): Promise<void> {
  act(() => {
    void navigate(path)
  })
  await settle()
}

describe('ProjectChangeReporter', () => {
  it('reports each switch with the one before it, and null on a page outside any project', async () => {
    const { heard } = await renderReporter('/p/a/tasks/r1')

    await go('/p/b/')
    await go('/tasks')
    await go('/settings/global')

    expect(heard).toEqual([
      { projectId: 'a', previousProjectId: null },
      { projectId: 'b', previousProjectId: 'a' },
      { projectId: null, previousProjectId: 'b' },
    ])
  })

  it('emits nothing on a workspace page at load, and nothing for navigation inside one project', async () => {
    const { heard } = await renderReporter('/tasks')
    expect(heard).toEqual([])

    await go('/p/a/')
    await go('/p/a/tasks/r1')
    await go('/p/a/settings')

    expect(heard).toEqual([{ projectId: 'a', previousProjectId: null }])
  })

  it('reports null for a project the registry does not know', async () => {
    const { heard } = await renderReporter('/p/a/')

    await go('/p/ghost/')

    expect(heard).toEqual([
      { projectId: 'a', previousProjectId: null },
      { projectId: null, previousProjectId: 'a' },
    ])
  })

  it('waits for the registry, then reports what it says', async () => {
    const { heard, client } = await renderReporter('/p/b/', { registry: null })
    expect(heard).toEqual([])

    act(() => {
      client.setQueryData(workspaceQueryKeys.projects, REGISTRY)
    })
    await settle()

    expect(heard).toEqual([{ projectId: 'b', previousProjectId: null }])
  })

  it('never reports the default alias itself', async () => {
    const { heard } = await renderReporter('/p/default/')

    expect(heard).toEqual([])
  })

  it('emits once under StrictMode’s double effects', async () => {
    const { heard } = await renderReporter('/p/a/', { strict: true })

    await go('/p/b/')

    expect(heard).toEqual([
      { projectId: 'a', previousProjectId: null },
      { projectId: 'b', previousProjectId: 'a' },
    ])
  })
})

describe('shownProject', () => {
  const loaded = { data: REGISTRY, isError: false }
  const loading = { data: undefined, isError: false }
  const errored = { data: undefined, isError: true }

  it.each<[string, string, { data?: ProjectsResponse; isError: boolean }, string | null | undefined]>([
    ['a registered project', '/p/b/tasks/r1', loaded, 'b'],
    ['the boot project', '/p/a', loaded, 'a'],
    ['an unknown project', '/p/ghost/', loaded, null],
    ['the global Tasks page', '/tasks', loaded, null],
    ['global settings', '/settings/global/appearance', loaded, null],
    ['the default alias, before it is normalized', '/p/default/tasks', loaded, undefined],
    ['a project while the registry loads', '/p/b/', loading, undefined],
    ['a project when the registry errored: the URL’s id', '/p/b/', errored, 'b'],
    ['the default alias when the registry errored', '/p/default/', errored, undefined],
    ['an encoded id, decoded', '/p/my%2Dproject/', errored, 'my-project'],
  ])('%s', (_name, pathname, projects, expected) => {
    expect(shownProject(pathname, projects)).toBe(expected)
  })
})
