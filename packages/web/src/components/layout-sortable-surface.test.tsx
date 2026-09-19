import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LayoutElement } from './layout-element'
import { LayoutRegistryProvider } from './layout-registry'
import { LayoutSortableSurface, resolveLayoutMove } from './layout-sortable-surface'
import { LayoutRegistry } from '@/lib/layout-elements'

function renderSurface(enabled: boolean, dragMode: 'sortable' | 'container' = 'sortable') {
  return render(
    <LayoutRegistryProvider>
      <LayoutSortableSurface enabled={enabled} dragMode={dragMode}>
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
    const handle = first?.querySelector('[data-layout-drag-handle]')
    expect(first?.getAttribute('role')).toBeNull()
    expect(handle?.getAttribute('role')).toBe('button')
    expect(handle?.getAttribute('aria-roledescription')).toBe('sortable')
    expect(handle?.getAttribute('data-edit-mode-action')).toBe('allow')
    expect(first?.getAttribute('data-layout-sortable')).toBe('true')
    expect(handle).not.toBeNull()
  })

  it('uses draggable containers without sortable transforms or a sorting context', () => {
    renderSurface(true, 'container')

    const first = screen.getByText('First').closest('[data-layout-element]') as HTMLElement
    const second = screen.getByText('Second').closest('[data-layout-element]') as HTMLElement
    const firstHandle = first.querySelector('[data-layout-drag-handle]') as HTMLElement

    expect(first.dataset.layoutDragMode).toBe('container')
    expect(second.dataset.layoutDragMode).toBe('container')
    expect(first.dataset.layoutSortable).toBe('false')
    expect(first.style.transform).toBe('')
    expect(firstHandle.getAttribute('aria-roledescription')).toBe('draggable')
  })

  it('keeps the source and siblings static while a container drag is active', () => {
    renderSurface(true, 'container')

    const first = screen.getByText('First').closest('[data-layout-element]') as HTMLElement
    const second = screen.getByText('Second').closest('[data-layout-element]') as HTMLElement
    const handle = first.querySelector('[data-layout-drag-handle]') as HTMLElement

    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 30, clientY: 30 })

    expect(first.dataset.layoutDragging).toBe('true')
    expect(first.style.transform).toBe('')
    expect(second.style.transform).toBe('')
    expect(first.style.visibility).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(first.dataset.layoutDragging).toBe('false')
    expect(first.style.visibility).toBe('')
  })

  it('resolves same-parent targets and limits cross-parent movement to groups', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'first', kind: 'widget' })
    registry.register({ id: 'second', kind: 'widget' })
    registry.register({ id: 'group', kind: 'group' })
    registry.register({ id: 'child', kind: 'widget', parentId: 'group' })
    registry.register({ id: 'other-group', kind: 'group' })
    registry.register({ id: 'other-child', kind: 'widget', parentId: 'other-group' })

    expect(resolveLayoutMove(registry, 'first', 'second')).toEqual({ id: 'first', targetId: 'second', position: 'after' })
    expect(resolveLayoutMove(registry, 'second', 'first')).toEqual({ id: 'second', targetId: 'first', position: 'before' })
    expect(resolveLayoutMove(registry, 'first', 'child')).toBeNull()
    expect(resolveLayoutMove(registry, 'group', 'other-child')).toEqual({
      id: 'group',
      targetId: 'other-child',
      position: 'before',
      parentId: 'other-group',
    })
  })

})
