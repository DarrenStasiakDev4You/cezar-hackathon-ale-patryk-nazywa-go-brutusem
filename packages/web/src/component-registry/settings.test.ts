import { describe, expect, it, vi } from 'vitest'
import { booleanSetting, defineComponentContract, defineSettings, numberSetting, selectSetting, stringSetting, type ComponentImplementation } from '@open-mercato/cezar-extension-api'
import { fakeScope } from '../extensions/registry.fixtures'
import { createComponentRegistry } from './registry'
import { createMemoryComponentSettingsStore, createPersistentComponentSettingsStore } from './settings'

const apiState = vi.hoisted(() => {
  let workspace: Record<string, unknown> = {}
  const projects = new Map<string, Record<string, unknown>>()
  return {
    reset() { workspace = {}; projects.clear() },
    workspace() { return workspace },
    project(id: string) { return projects.get(id) ?? {} },
    getUiState: vi.fn(async () => ({ ...projects.get('repo-a') ?? {} })),
    putUiState: vi.fn(async (patch: Record<string, unknown>) => { const next = { ...projects.get('repo-a') ?? {}, ...patch }; projects.set('repo-a', next); return next }),
    getWorkspaceUiState: vi.fn(async () => ({ ...workspace })),
    putWorkspaceUiState: vi.fn(async (patch: Record<string, unknown>) => { workspace = { ...workspace, ...patch }; return { ...workspace } }),
  }
})
vi.mock('../api/client', () => ({
  getUiState: apiState.getUiState,
  putUiState: apiState.putUiState,
  getWorkspaceUiState: apiState.getWorkspaceUiState,
  putWorkspaceUiState: apiState.putWorkspaceUiState,
}))

const Header = defineComponentContract<{ title: string }>('cezar.fixture.settings-header', { version: 1 })
const Definition = defineSettings({ scope: 'global', schema: { compact: booleanSetting({ default: false }) } })
const implementation: ComponentImplementation<{ title: string }, typeof Definition['defaults']> = { id: 'acme.settings-header', title: 'Settings', settings: Definition, component: () => null }

describe('component settings registry', () => {
  it('isolates exact ids, canonicalizes writes and resets', async () => {
    const store = createMemoryComponentSettingsStore(); const registry = createComponentRegistry({ contracts: [Header], settings: store }); const scope = fakeScope('acme'); const handle = registry.forExtension(scope.scope).provide(Header, implementation)
    expect(await handle.getSettings()).toEqual({ compact: false })
    const changed = vi.fn(); handle.onSettingsChange(changed)
    await registry.setSettings(handle.componentId, { compact: true }); await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(await handle.getSettings()).toEqual({ compact: true }); await registry.resetSettings(handle.componentId); expect(await handle.getSettings()).toEqual({ compact: false })
    await expect(registry.setSettings(handle.componentId, { compact: 'bad' })).rejects.toMatchObject({ code: 'invalid-settings' })
  })
  it('preserves values through a fresh registry and rejects missing project scope', async () => {
    const store = createMemoryComponentSettingsStore(); const first = createComponentRegistry({ contracts: [Header], settings: store }); const h = first.forExtension(fakeScope('acme').scope).provide(Header, implementation); await first.setSettings(h.componentId, { compact: true })
    const fresh = createComponentRegistry({ contracts: [Header], settings: store }); const h2 = fresh.forExtension(fakeScope('acme').scope).provide(Header, implementation); expect(await h2.getSettings()).toEqual({ compact: true })
    const project = defineSettings({ scope: 'project', schema: { compact: booleanSetting({ default: false }) } }); const projectReg = createComponentRegistry({ contracts: [Header], settings: store, resolveProjectId: () => null }); const ph = projectReg.forExtension(fakeScope('project').scope).provide(Header, { ...implementation, id: 'project.settings-header', settings: project, component: () => null }); await expect(ph.getSettings()).rejects.toMatchObject({ code: 'settings-unavailable' })
  })
  it('persists global and project targets without dropping unrelated ids', async () => {
    apiState.reset()
    const store = createPersistentComponentSettingsStore({ resolveProjectId: () => 'repo-a' })
    await store.set({ scope: 'global' }, 'acme.global-header', { compact: true })
    await store.set({ scope: 'global' }, 'acme.other-header', { compact: false })
    await store.set({ scope: 'project', projectId: 'repo-a' }, 'acme.project-header', { compact: true })
    const fresh = createPersistentComponentSettingsStore({ resolveProjectId: () => 'repo-a' })
    expect(await fresh.get({ scope: 'global' }, 'acme.global-header')).toEqual({ compact: true })
    expect(await fresh.get({ scope: 'global' }, 'acme.other-header')).toEqual({ compact: false })
    expect(await fresh.get({ scope: 'project', projectId: 'repo-a' }, 'acme.project-header')).toEqual({ compact: true })
    expect(apiState.workspace().componentSettings).toEqual({ 'acme.global-header': { compact: true }, 'acme.other-header': { compact: false } })
    expect(apiState.project('repo-a').componentSettings).toEqual({ 'acme.project-header': { compact: true } })
  })

  it('round-trips scalar values through a fresh persistent store in both scopes', async () => {
    apiState.reset()
    const first = createPersistentComponentSettingsStore({ resolveProjectId: () => 'repo-a' })
    const global = { enabled: true, title: 'Header', count: 48, density: 'cozy' }
    const project = { enabled: false, title: 'Project', count: 16, density: 'compact' }
    await first.set({ scope: 'global' }, 'acme.scalar-header', global)
    await first.set({ scope: 'project', projectId: 'repo-a' }, 'acme.scalar-header', project)

    const fresh = createPersistentComponentSettingsStore({ resolveProjectId: () => 'repo-a' })
    expect(await fresh.get({ scope: 'global' }, 'acme.scalar-header')).toEqual(global)
    expect(await fresh.get({ scope: 'project', projectId: 'repo-a' }, 'acme.scalar-header')).toEqual(project)
  })

  it('deduplicates concurrent reads of one target', async () => {
    apiState.reset()
    apiState.getWorkspaceUiState.mockClear()
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    apiState.getWorkspaceUiState.mockImplementationOnce(async () => { await pending; return { componentSettings: { 'acme.header': { title: 'Header' } } } })
    const store = createPersistentComponentSettingsStore({ resolveProjectId: () => 'repo-a' })
    const first = store.get({ scope: 'global' }, 'acme.header')
    const second = store.get({ scope: 'global' }, 'acme.header')
    expect(apiState.getWorkspaceUiState).toHaveBeenCalledTimes(1)
    release?.()
    await expect(Promise.all([first, second])).resolves.toEqual([{ title: 'Header' }, { title: 'Header' }])
  })

  it('merges concurrent field writes inside one implementation atomically', async () => {
    const store = createMemoryComponentSettingsStore()
    const registry = createComponentRegistry({ contracts: [Header], settings: store })
    const definition = defineSettings({
      scope: 'global',
      schema: {
        enabled: booleanSetting({ default: false }),
        title: stringSetting({ default: 'Header' }),
        count: numberSetting({ default: 12 }),
        density: selectSetting({ default: 'cozy', options: [{ value: 'compact' }, { value: 'cozy' }] }),
      },
    })
    const handle = registry.forExtension(fakeScope('acme').scope).provide(Header, {
      ...implementation,
      settings: definition,
      component: () => null,
    } as unknown as ComponentImplementation<{ title: string }, unknown>)

    await Promise.all([
      registry.setSettings(handle.componentId, { title: 'Changed' }),
      registry.setSettings(handle.componentId, { count: 48 }),
    ])
    expect(await handle.getSettings()).toMatchObject({ title: 'Changed', count: 48 })
  })

  it('rejects non-scalar store entries', async () => {
    const store = createMemoryComponentSettingsStore()
    await expect(store.set({ scope: 'global' }, 'acme.header', { nested: { value: true } } as never)).rejects.toMatchObject({ code: 'invalid-settings' })
  })
})
