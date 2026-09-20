import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { booleanSetting, numberSetting, stringSetting } from '@open-mercato/cezar-extension-api'

import { ComponentSettingsField } from './component-settings-field'

describe('ComponentSettingsField', () => {
  it('renders a labelled boolean and saves its scalar value', async () => {
    const setSettings = vi.fn(async () => {})
    const onSaved = vi.fn()
    const definition = booleanSetting({ default: false, label: 'Show metadata', description: 'Display extra task metadata.' })

    render(<ComponentSettingsField
      componentId="acme.header"
      fieldKey="showMetadata"
      definition={definition}
      value={false}
      defaultValue={false}
      registry={{ setSettings, resetSettings: vi.fn(async () => {}) }}
      onSaved={onSaved}
    />)

    expect(screen.getByText('Display extra task metadata.')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Show metadata' }))

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith('acme.header', { showMetadata: true }))
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('flushes text and numeric drafts on blur', async () => {
    const setSettings = vi.fn(async () => {})
    const registry = { setSettings, resetSettings: vi.fn(async () => {}) }
    const text = stringSetting({ default: 'old', label: 'Label' })
    const number = numberSetting({ default: 2, min: 1, max: 5, label: 'Columns' })

    render(<>
      <ComponentSettingsField componentId="acme.header" fieldKey="label" definition={text} value="old" defaultValue="old" registry={registry} />
      <ComponentSettingsField componentId="acme.header" fieldKey="columns" definition={number} value={2} defaultValue={2} registry={registry} />
    </>)

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'new' } })
    fireEvent.blur(screen.getByLabelText('Label'))
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '4' } })
    fireEvent.blur(screen.getByLabelText('Columns'))

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith('acme.header', { label: 'new' })
      expect(setSettings).toHaveBeenCalledWith('acme.header', { columns: 4 })
    })
  })

  it('resets a non-default value and disables the control with an explanation', async () => {
    const resetSettings = vi.fn(async () => {})
    const onSaved = vi.fn()
    const definition = stringSetting({ default: 'default', label: 'Title' })

    render(<ComponentSettingsField
      componentId="acme.header"
      fieldKey="title"
      definition={definition}
      value="custom"
      defaultValue="default"
      registry={{ setSettings: vi.fn(async () => {}), resetSettings }}
      disabled
      disabledReason="Settings are unavailable."
      onSaved={onSaved}
    />)

    expect(screen.getByText('Settings are unavailable.')).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reset Title to default' }) as HTMLButtonElement).disabled).toBe(true)
    expect(resetSettings).not.toHaveBeenCalled()
  })
})
