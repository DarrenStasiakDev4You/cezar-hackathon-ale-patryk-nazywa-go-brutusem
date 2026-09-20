import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponentContract, type ComponentImplementation } from '@open-mercato/cezar-extension-api'

import { createQueryClient } from '@/api/query-client'
import { fakeScope } from '@/extensions/registry.fixtures'

import { ComponentHost } from './component-host'
import { createComponentPreferences, type ComponentPreferencesStorage } from './preferences'
import { StoredComponentsProvider } from './stored-components-provider'
import { createComponentRegistry } from './registry'

interface HeaderProps {
  readonly label: string
}

const Header = defineComponentContract<HeaderProps>('cezar.fixture.live-header', { version: 1 })
const CoreHeader: ComponentImplementation<HeaderProps> = {
  id: 'cezar.fixture.live-header.default',
  title: 'Core header',
  component: ({ label }) => <span>{label}</span>,
}

afterEach(cleanup)

describe('StoredComponentsProvider', () => {
  it('re-renders a mounted host when the user changes and resets an implementation', async () => {
    const registry = createComponentRegistry({ contracts: [Header] })
    registry.register(Header, CoreHeader)
    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, {
      id: 'acme.jira.live-header',
      title: 'Jira header',
      component: ({ label }) => <span>{label} from Jira</span>,
    })
    const storage: ComponentPreferencesStorage = {
      load: async () => ({}),
      save: async () => undefined,
    }
    const preferences = createComponentPreferences({ registry, contracts: [Header], storage })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <StoredComponentsProvider registry={registry} preferences={preferences}>
          <ComponentHost contract={Header} subject="task-1" props={{ label: 'Task' }} />
        </StoredComponentsProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe('cezar.fixture.live-header.default'))
    await preferences.set(Header.id, 'acme.jira.live-header')
    await waitFor(() => expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe('acme.jira.live-header'))
    await preferences.reset(Header.id)
    await waitFor(() => expect(document.querySelector('[data-slot="component-host"]')?.getAttribute('data-component')).toBe('cezar.fixture.live-header.default'))
  })
})
