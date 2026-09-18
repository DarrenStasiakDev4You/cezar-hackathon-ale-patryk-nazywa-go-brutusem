import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditModeControl } from './edit-mode-control'

afterEach(cleanup)

describe('EditModeControl', () => {
  it('enters edit mode without opening a modal', () => {
    const onEnabledChange = vi.fn()

    render(<EditModeControl enabled={false} onEnabledChange={onEnabledChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(onEnabledChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders only the exit action while edit mode is active', () => {
    const onEnabledChange = vi.fn()

    render(<EditModeControl enabled onEnabledChange={onEnabledChange} />)

    expect(screen.getByRole('status').textContent).toContain('You are in edit mode')
    expect(screen.getByRole('button', { name: 'Exit edit mode' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit mode$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Exit edit mode' }))
    expect(onEnabledChange).toHaveBeenCalledWith(false)
  })
})
