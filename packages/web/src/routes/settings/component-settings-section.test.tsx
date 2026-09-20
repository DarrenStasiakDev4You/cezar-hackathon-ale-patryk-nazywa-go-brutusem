import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TaskHeaderMain, booleanSetting, defineSettings } from '@open-mercato/cezar-extension-api'

import { createQueryClient } from '@/api/query-client'
import { ComponentsProvider } from '@/component-registry/provider'
import { createCoreComponentRegistry } from '@/component-registry/core-components'

import { ComponentSettingsSection, hasConfigurableComponent } from './component-settings-section'

describe('ComponentSettingsSection', () => {
  it('is configurable only when a usable implementation declares settings', () => {
    const registry = createCoreComponentRegistry()
    expect(hasConfigurableComponent(registry)).toBe(false)

    registry.register(TaskHeaderMain, {
      id: 'cezar.settings-header',
      title: 'Settings header',
      capabilities: ['shows-title', 'shows-status', 'shows-meta'],
      component: () => null,
      settings: defineSettings({ scope: 'global', schema: { compact: booleanSetting({ default: false }) } }),
    })
    expect(hasConfigurableComponent(registry)).toBe(true)
  })

  it('groups configured implementations by contract and persists a field change', async () => {
    const registry = createCoreComponentRegistry()
    const definition = defineSettings({
      scope: 'global',
      schema: { compact: booleanSetting({ default: false, label: 'Compact mode' }) },
    })
    registry.register(TaskHeaderMain, {
      id: 'cezar.settings-header',
      title: 'Settings header',
      component: () => null,
      capabilities: ['shows-title', 'shows-status', 'shows-meta'],
      settings: definition,
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ComponentsProvider registry={registry}>
          <ComponentSettingsSection />
        </ComponentsProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Task header' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Settings header' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('switch', { name: 'Compact mode' }))

    await waitFor(async () => expect(await registry.getSettings('cezar.settings-header')).toEqual({ compact: true }))
  })
})
