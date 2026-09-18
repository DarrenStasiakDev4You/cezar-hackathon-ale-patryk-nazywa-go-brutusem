import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EditModeControl } from './edit-mode-control'

describe('EditModeControl', () => {
  it('enables edit mode, shows the confirmation modal and renders the exit banner', () => {
    render(<EditModeControl />)

    fireEvent.click(screen.getByRole('button', { name: 'Enable edit mode' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('You have enabled edit mode.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('You are in edit mode')
    expect(screen.getByRole('button', { name: 'Exit edit mode' })).toBeTruthy()
  })

  it('exits edit mode from the banner', () => {
    render(<EditModeControl />)

    fireEvent.click(screen.getByRole('button', { name: 'Enable edit mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit edit mode' }))

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Enable edit mode' })).toBeTruthy()
  })
})
