import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LayoutElement } from './layout-element'
import { LayoutRegistryProvider } from './layout-registry'
import { LayoutSortableSurface, resolveLayoutMove } from './layout-sortable-surface'
import { LayoutRegistry } from '@/lib/layout-elements'

function renderSurface(enabled: boolean) {
  return render(
    <LayoutRegistryProvider>
      <LayoutSortableSurface enabled={enabled}>
        <LayoutElement id="first" kind="widget">First</LayoutElement>
        <LayoutElement id="second" kind="widget">Second</LayoutElement>
      </LayoutSortableSurface>
    </LayoutRegistryProvider>,
  )
}

describe('LayoutSortableSurface', () => {
  afterEach(() => cleanup())

  it('keeps normal mode free of drag handles and sortable affordances', () => {
    renderSurface(false)

    expect(screen.queryByRole('button', { name: /przenieś/i })).toBeNull()
    expect(screen.getByText('First').closest('[data-layout-element]')?.getAttribute('data-layout-sortable')).toBe('false')
  })

  it('exposes an explicit accessible handle only in edit mode', () => {
    renderSurface(true)

    const first = screen.getByText('First').closest('[data-layout-element]')
    expect(first?.getAttribute('role')).toBe('button')
    expect(first?.getAttribute('aria-roledescription')).toBe('sortable')
    expect(first?.getAttribute('data-edit-mode-action')).toBe('allow')
    expect(first?.getAttribute('data-layout-sortable')).toBe('true')
    expect(first?.querySelector('[data-layout-drag-handle]')).not.toBeNull()
  })

  it('resolves only same-parent drop targets and derives direction from sibling order', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'first', kind: 'widget' })
    registry.register({ id: 'second', kind: 'widget' })
    registry.register({ id: 'group', kind: 'group' })
    registry.register({ id: 'child', kind: 'widget', parentId: 'group' })

    expect(resolveLayoutMove(registry, 'first', 'second')).toEqual({ id: 'first', targetId: 'second', position: 'after' })
    expect(resolveLayoutMove(registry, 'second', 'first')).toEqual({ id: 'second', targetId: 'first', position: 'before' })
    expect(resolveLayoutMove(registry, 'first', 'child')).toBeNull()
  })

})
