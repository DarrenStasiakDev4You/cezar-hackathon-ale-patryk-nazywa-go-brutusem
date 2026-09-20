import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TaskHeaderMain, type ComponentProps } from '@open-mercato/cezar-extension-api'

import { createQueryClient } from '@/api/query-client'
import { createEventBus } from '@/events/bus'
import { createCommandRegistry } from '@/commands/registry'
import { registerCoreCommands } from '@/commands/core-commands'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { ComponentsProvider } from '@/component-registry/provider'
import { ComponentHost } from '@/component-registry/component-host'
import { createMemoryComponentSettingsStore, type ComponentSettingsStore } from '@/component-registry/settings'
import { cockpitServices, startExtensionHost } from '@/extensions/host'

import { configurableHeaderExtension } from '../../../test-fixtures/extensions/configurable-header'
import { ComponentSettingsSection } from './component-settings-section'

type HeaderProps = ComponentProps<typeof TaskHeaderMain>

async function boot(store: ComponentSettingsStore) {
  const components = createCoreComponentRegistry({ settings: store })
  const commands = createCommandRegistry()
  registerCoreCommands(commands, { queryClient: new QueryClient() })
  const events = createEventBus()
  const host = startExtensionHost({
    extensions: [configurableHeaderExtension],
    services: cockpitServices({ commands, events, components }),
    onError: () => {},
  })
  await host.ready
  return components
}

function surface(components: ReturnType<typeof createCoreComponentRegistry>, showSettings = true) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ComponentsProvider
        registry={components}
        preferenceOf={(contractId) => contractId === TaskHeaderMain.id ? 'fixture.configurable-header.task-header' : null}
      >
        <ComponentHost contract={TaskHeaderMain} subject="fixture-task" props={{} as HeaderProps} />
        {showSettings ? <ComponentSettingsSection /> : null}
      </ComponentsProvider>
    </QueryClientProvider>
  )
}

afterEach(() => cleanup())

beforeEach(() => {
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    scrollIntoView: () => {},
  })
})

describe('configurable component settings fixture', () => {
  it('changes the live component and preserves all four values across a fresh host', async () => {
    const store = createMemoryComponentSettingsStore()
    const components = await boot(store)

    const { unmount } = render(surface(components))
    const fixture = await screen.findByText('Fixture header')
    expect(fixture.getAttribute('data-compact')).toBe('false')

    fireEvent.click(await screen.findByRole('switch', { name: 'Compact header' }))
    await waitFor(() => expect(fixture.getAttribute('data-compact')).toBe('true'))

    const label = screen.getByLabelText('Label')
    fireEvent.change(label, { target: { value: 'Changed header' } })
    fireEvent.blur(label)
    await waitFor(() => expect(fixture.getAttribute('data-label')).toBe('Changed header'))

    const columns = screen.getByLabelText('Columns')
    fireEvent.change(columns, { target: { value: '3' } })
    fireEvent.blur(columns)
    await waitFor(() => expect(fixture.getAttribute('data-columns')).toBe('3'))

    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Tone' }), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(await screen.findByRole('option', { name: 'Accent' }))
    await waitFor(() => expect(fixture.getAttribute('data-tone')).toBe('accent'))

    await waitFor(async () => expect(await components.getSettings('fixture.configurable-header.task-header')).toEqual({
      compact: true,
      label: 'Changed header',
      columns: 3,
      tone: 'accent',
    }))

    unmount()
    const fresh = await boot(store)
    render(surface(fresh, false))
    const reloaded = await screen.findByText('Changed header')
    expect(reloaded.getAttribute('data-compact')).toBe('true')
    expect(reloaded.getAttribute('data-columns')).toBe('3')
    expect(reloaded.getAttribute('data-tone')).toBe('accent')
  })
})
