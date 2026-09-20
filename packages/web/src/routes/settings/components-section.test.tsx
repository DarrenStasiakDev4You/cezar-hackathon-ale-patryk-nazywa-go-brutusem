import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TaskHeaderMain } from '@open-mercato/cezar-extension-api'

import { createQueryClient } from '@/api/query-client'
import { fakeScope } from '@/extensions/registry.fixtures'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { createComponentPreferences, type ComponentPreferencesStorage } from '@/component-registry/preferences'
import { StoredComponentsProvider } from '@/component-registry/stored-components-provider'
import { ComponentsSection } from './components-section'

function renderSection() {
  const registry = createCoreComponentRegistry({ onDiagnostic: () => {} })
  registry.forExtension(fakeScope('acme.jira').scope).provide(TaskHeaderMain, {
    id: 'acme.jira.task-header',
    title: 'Jira header',
    description: 'Header provided by Jira extension',
    capabilities: ['shows-title', 'shows-status', 'shows-meta'],
    component: () => null,
  })
  registry.forExtension(fakeScope('acme.incompatible').scope).provide(TaskHeaderMain, {
    id: 'acme.incompatible.task-header',
    title: 'Incompatible header',
    capabilities: ['shows-title'],
    component: () => null,
  })
  let saved: Record<string, unknown> = {}
  const storage: ComponentPreferencesStorage = {
    load: async () => ({}),
    save: async (value) => {
      saved = value
    },
  }
  const preferences = createComponentPreferences({
    registry,
    contracts: [TaskHeaderMain],
    storage,
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <StoredComponentsProvider registry={registry} preferences={preferences}>
        <ComponentsSection />
      </StoredComponentsProvider>
    </QueryClientProvider>,
  )
  return { preferences, getSaved: () => saved }
}

function headerSection() {
  const section = document.querySelector('[data-contract-id="cezar.task.header.main"]')
  if (!(section instanceof HTMLElement)) throw new Error('Task Header settings section was not rendered')
  return within(section)
}

afterEach(cleanup)

describe('Settings → Interface → Components', () => {
  it('always shows core, lists only compatible implementations, and shows the provider', async () => {
    renderSection()

    const select = headerSection().getByRole('combobox', { name: 'Implementation' })
    expect(select.textContent).toContain('Task header')
    expect(select.textContent).toContain('Jira header')
    expect(select.textContent).not.toContain('Incompatible header')
    expect(document.querySelector('[data-slot="components-section"]')).toBeTruthy()
    expect(headerSection().getByText('Cezar core')).toBeTruthy()
  })

  it('changes the live preference and resets it to core without a reload', async () => {
    const { preferences, getSaved } = renderSection()
    const header = headerSection()
    const select = header.getByRole('combobox', { name: 'Implementation' })

    fireEvent.change(select, { target: { value: 'acme.jira.task-header' } })
    await waitFor(() => expect(preferences.get(TaskHeaderMain.id)).toBe('acme.jira.task-header'))
    expect(document.querySelector('[data-slot="component-current"]')?.textContent).toContain('Jira header')
    expect(getSaved()).toEqual({ implementations: { [TaskHeaderMain.id]: 'acme.jira.task-header' } })

    fireEvent.click(header.getByRole('button', { name: 'Reset to core' }))
    await waitFor(() => expect(preferences.get(TaskHeaderMain.id)).toBeUndefined())
    expect(document.querySelector('[data-slot="component-current"]')?.textContent).toContain('Task header')
  })
})
