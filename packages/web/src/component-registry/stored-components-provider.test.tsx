import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponentContract, type ComponentImplementation } from '@open-mercato/cezar-extension-api'

import type { WorkspaceUiState } from '@open-mercato/cezar-api-client'

import { workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'

import { fakeScope } from '../extensions/registry.fixtures'
import { ComponentHost } from './component-host'
import { createComponentRegistry, type CockpitComponentRegistry } from './registry'
import { createComponentPreferences, type ComponentPreferences } from './preferences'
import {
  StoredComponentsProvider,
  uiStateComponentStorage,
  useComponentPreferences,
} from './stored-components-provider'

interface HeaderProps {
  readonly title: string
}

const Header = defineComponentContract<HeaderProps>('cezar.fixture.task-header', { version: 1 })
const DEFAULT_ID = 'cezar.fixture.task-header.default'
const COMPACT_ID = 'cezar.fixture.task-header.compact'
const JIRA_ID = 'acme.jira.task-header'
const Render = () => null

const implementation = (id: string, title: string): ComponentImplementation<HeaderProps> => ({
  id,
  title,
  component: Render,
})

function fixtureRegistry(withJira = true): CockpitComponentRegistry {
  const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
  registry.register(Header, implementation(DEFAULT_ID, 'Task header'))
  registry.register(Header, implementation(COMPACT_ID, 'Compact header'))
  if (withJira) registry.forExtension(fakeScope('acme.jira').scope).provide(Header, implementation(JIRA_ID, 'Jira header'))
  return registry
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeWorkspaceServer(initial: WorkspaceUiState = {}) {
  let state = initial
  let failWrites = false
  const requests: { method: string; url: string }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    requests.push({ method, url })
    if (url !== '/api/v1/workspace/ui-state') return json({ error: 'not found' }, 404)
    if (method === 'GET') return json(state)
    if (failWrites) return json({ error: 'read-only' }, 500)
    const patch = JSON.parse(String(init.body)) as WorkspaceUiState
    state = { ...state, ...patch }
    return json(state)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    requests,
    setFailWrites(value: boolean) {
      failWrites = value
    },
  }
}

function mount(
  queryClient: QueryClient,
  registry: CockpitComponentRegistry,
  preferences: ComponentPreferences,
) {
  const tree = render(
    <QueryClientProvider client={queryClient}>
      <StoredComponentsProvider registry={registry} preferences={preferences}>
        <ComponentHost contract={Header} props={{ title: 'Task' }} />
      </StoredComponentsProvider>
    </QueryClientProvider>,
  )
  return tree
}

function componentId(container: HTMLElement): string | null {
  return container.querySelector('[data-slot="component-host"]')?.getAttribute('data-component') ?? null
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('StoredComponentsProvider', () => {
  it('keeps the zero-config default and does not write during hydration', async () => {
    const server = fakeWorkspaceServer()
    const queryClient = createQueryClient()
    const registry = fixtureRegistry()
    const preferences = createComponentPreferences({ registry, contracts: [Header], storage: uiStateComponentStorage(queryClient) })
    const tree = mount(queryClient, registry, preferences)

    await waitFor(() => expect(preferences.revision()).toBe(1))

    expect(componentId(tree.container)).toBe(DEFAULT_ID)
    expect(server.requests.filter(({ method }) => method === 'PUT')).toEqual([])
    expect(server.requests.filter(({ method }) => method === 'GET')).toHaveLength(1)
  })

  it('persists a choice and hydrates it after a refresh', async () => {
    const server = fakeWorkspaceServer()
    const firstClient = createQueryClient()
    const firstRegistry = fixtureRegistry()
    const first = createComponentPreferences({
      registry: firstRegistry,
      contracts: [Header],
      storage: uiStateComponentStorage(firstClient),
    })
    const firstTree = mount(firstClient, firstRegistry, first)
    await first.ready

    await act(async () => first.set(Header.id, JIRA_ID))
    expect(componentId(firstTree.container)).toBe(JIRA_ID)
    expect(server.requests.filter(({ method }) => method === 'PUT')).toHaveLength(1)
    firstTree.unmount()

    const secondClient = createQueryClient()
    const secondRegistry = fixtureRegistry()
    const second = createComponentPreferences({
      registry: secondRegistry,
      contracts: [Header],
      storage: uiStateComponentStorage(secondClient),
    })
    const secondTree = mount(secondClient, secondRegistry, second)
    await second.ready

    expect(componentId(secondTree.container)).toBe(JIRA_ID)
    expect(server.requests.filter(({ method }) => method === 'GET')).toHaveLength(2)
  })

  it('keeps a missing implementation stored while rendering core default', async () => {
    const server = fakeWorkspaceServer({ components: { implementations: { [Header.id]: JIRA_ID } } })
    const queryClient = createQueryClient()
    const registry = fixtureRegistry(false)
    const preferences = createComponentPreferences({ registry, contracts: [Header], storage: uiStateComponentStorage(queryClient) })
    const tree = mount(queryClient, registry, preferences)

    await preferences.ready

    expect(componentId(tree.container)).toBe(DEFAULT_ID)
    expect(preferences.get(Header.id)).toBe(JIRA_ID)
    expect(server.requests.filter(({ method }) => method === 'PUT')).toEqual([])
  })

  it('restores core default immediately and keeps it after refresh', async () => {
    const server = fakeWorkspaceServer({ components: { implementations: { [Header.id]: JIRA_ID } } })
    const firstClient = createQueryClient()
    const firstRegistry = fixtureRegistry()
    const first = createComponentPreferences({ registry: firstRegistry, contracts: [Header], storage: uiStateComponentStorage(firstClient) })
    const firstTree = mount(firstClient, firstRegistry, first)
    await first.ready

    await act(async () => first.reset(Header.id))
    expect(componentId(firstTree.container)).toBe(DEFAULT_ID)
    firstTree.unmount()

    const secondClient = createQueryClient()
    const secondRegistry = fixtureRegistry()
    const second = createComponentPreferences({ registry: secondRegistry, contracts: [Header], storage: uiStateComponentStorage(secondClient) })
    const secondTree = mount(secondClient, secondRegistry, second)
    await second.ready

    expect(componentId(secondTree.container)).toBe(DEFAULT_ID)
    expect(server.requests.filter(({ method }) => method === 'PUT')).toHaveLength(1)
  })

  it('shares the existing ui-state query and updates it with the server answer', async () => {
    const server = fakeWorkspaceServer({ appearance: { accent: 'violet' } })
    const queryClient = createQueryClient()
    queryClient.setQueryData(workspaceQueryKeys.uiState, { appearance: { accent: 'violet' } })
    const storage = uiStateComponentStorage(queryClient)

    expect(await storage.load()).toEqual({})
    expect(server.requests).toEqual([])
    await storage.save({ implementations: { [Header.id]: JIRA_ID } })

    expect(queryClient.getQueryData(workspaceQueryKeys.uiState)).toEqual({
      appearance: { accent: 'violet' },
      components: { implementations: { [Header.id]: JIRA_ID } },
    })
  })

  it('rolls back the host to the stored choice when PUT fails', async () => {
    const server = fakeWorkspaceServer({ components: { implementations: { [Header.id]: JIRA_ID } } })
    const queryClient = createQueryClient()
    const registry = fixtureRegistry()
    const preferences = createComponentPreferences({ registry, contracts: [Header], storage: uiStateComponentStorage(queryClient) })
    const tree = mount(queryClient, registry, preferences)
    await preferences.ready
    server.setFailWrites(true)

    await expect(act(async () => preferences.set(Header.id, COMPACT_ID))).rejects.toMatchObject({ code: 'write-failed' })

    await waitFor(() => expect(componentId(tree.container)).toBe(JIRA_ID))
  })

  it('requires the provider for useComponentPreferences', () => {
    expect(() => renderHook(() => useComponentPreferences())).toThrow(/StoredComponentsProvider/)
  })
})
