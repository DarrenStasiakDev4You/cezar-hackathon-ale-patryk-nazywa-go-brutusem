import { describe, expect, it, vi } from 'vitest'
import { booleanSetting, defineComponentContract, defineSettings, type ComponentImplementation } from '@open-mercato/cezar-extension-api'
import { fakeScope } from '../extensions/registry.fixtures'
import { createComponentRegistry } from './registry'
import { createMemoryComponentSettingsStore } from './settings'

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
})
