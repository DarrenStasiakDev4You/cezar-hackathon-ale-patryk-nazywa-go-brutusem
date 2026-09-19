import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './app-shell'
import { LayoutElementContextMenu, type LayoutContextMenuTarget } from './layout-context-menu'
import { LayoutElement } from './layout-element'
import { LayoutRegistryProvider } from './layout-registry'
import { ThemeProvider } from './theme-provider'

function renderLayout(props: { enabled?: boolean; onDelete?: (target: LayoutContextMenuTarget) => void; confirmDelete?: (target: LayoutContextMenuTarget) => boolean | Promise<boolean> } = {}) {
  return render(
    <LayoutRegistryProvider>
      <LayoutElementContextMenu enabled={props.enabled ?? true} onDelete={props.onDelete ?? vi.fn()} confirmDelete={props.confirmDelete}>
        <LayoutElement id="group" kind="group">
          <LayoutElement id="card" kind="widget" parentId="group">
            <span>Revenue</span>
          </LayoutElement>
        </LayoutElement>
        <div data-testid="outside">Outside</div>
      </LayoutElementContextMenu>
    </LayoutRegistryProvider>,
  )
}

describe('LayoutElementContextMenu', () => {
  afterEach(() => cleanup())

  it('opens only for the nearest registered element and passes a widget target to delete', async () => {
    const onDelete = vi.fn()
    renderLayout({ onDelete })
    await waitFor(() => expect(screen.getByText('Revenue').closest('[data-layout-id="card"]')).not.toBeNull())

    fireEvent.contextMenu(screen.getByText('Revenue'), { clientX: 120, clientY: 80 })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete layout element' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith({ id: 'card', kind: 'widget', subtreeIds: ['card'] })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('passes the complete nested group subtree in registry order', async () => {
    const onDelete = vi.fn()
    render(
      <LayoutRegistryProvider>
        <LayoutElementContextMenu enabled onDelete={onDelete}>
          <LayoutElement id="root" kind="group">
            <LayoutElement id="first" kind="widget" parentId="root" />
            <LayoutElement id="nested" kind="group" parentId="root">
              <LayoutElement id="last" kind="widget" parentId="nested" />
            </LayoutElement>
          </LayoutElement>
        </LayoutElementContextMenu>
      </LayoutRegistryProvider>,
    )
    await waitFor(() => expect(document.querySelector('[data-layout-id="root"]')).not.toBeNull())
    fireEvent.contextMenu(document.querySelector('[data-layout-id="root"]')!, { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete layout element' }))

    expect(onDelete).toHaveBeenCalledWith({ id: 'root', kind: 'group', subtreeIds: ['root', 'first', 'nested', 'last'] })
  })

  it('keeps the browser context menu untouched when disabled or outside the layout', () => {
    const onDelete = vi.fn()
    renderLayout({ enabled: false, onDelete })
    fireEvent.contextMenu(screen.getByText('Revenue'))
    expect(screen.queryByRole('menu')).toBeNull()

    renderLayout({ onDelete })
    const outside = screen.getAllByTestId('outside')[1]!
    fireEvent.contextMenu(outside)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('supports Escape, outside click, stale targets, and optional confirmation', async () => {
    const onDelete = vi.fn()
    const confirmDelete = vi.fn().mockResolvedValue(false)
    const view = renderLayout({ onDelete, confirmDelete })
    fireEvent.contextMenu(screen.getByText('Revenue'))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByText('Revenue'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByText('Revenue'))
    view.rerender(<LayoutRegistryProvider><LayoutElementContextMenu enabled onDelete={onDelete} confirmDelete={confirmDelete}>{null}</LayoutElementContextMenu></LayoutRegistryProvider>)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onDelete).not.toHaveBeenCalled()
    expect(confirmDelete).not.toHaveBeenCalled()
  })

  it('keeps Delete usable under the shell edit-mode guard, by click and by Enter', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    const onDelete = vi.fn()
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell>
            <LayoutRegistryProvider>
              <LayoutElementContextMenu enabled onDelete={onDelete}>
                <LayoutElement id="card" kind="widget">
                  <span>Revenue</span>
                </LayoutElement>
              </LayoutElementContextMenu>
            </LayoutRegistryProvider>
          </AppShell>
        </MemoryRouter>
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit mode' }))
    await waitFor(() => expect(document.querySelector('[data-layout-id="card"]')).not.toBeNull())

    fireEvent.contextMenu(screen.getByText('Revenue'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete layout element' }))
    expect(onDelete).toHaveBeenCalledTimes(1)

    fireEvent.contextMenu(screen.getByText('Revenue'))
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete layout element' })
    expect(fireEvent.keyDown(deleteItem, { key: 'Enter' })).toBe(true)
    vi.unstubAllGlobals()
  })

  it('clamps the menu to the viewport when the pointer is near an edge', async () => {
    const width = window.innerWidth
    const height = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 140 })
    renderLayout()
    fireEvent.contextMenu(screen.getByText('Revenue'), { clientX: 9999, clientY: 9999 })

    await waitFor(() => {
      const menu = screen.getByRole('menu')
      expect(menu.style.left).toBe('16px')
      expect(menu.style.top).toBe('20px')
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  })
})
