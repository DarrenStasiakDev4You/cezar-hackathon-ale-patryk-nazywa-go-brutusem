import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LayoutElement } from './layout-element'
import { LayoutRegistryProvider, useLayoutSnapshot } from './layout-registry'

function SnapshotProbe() {
  const snapshot = useLayoutSnapshot()
  return <output data-testid="snapshot">{snapshot.map((item) => item.id).join(',')}</output>
}

describe('layout element components', () => {
  it('registers nested elements, emits DOM projection attributes, and cleans up in StrictMode', async () => {
    const view = render(
      <StrictMode>
        <LayoutRegistryProvider>
          <SnapshotProbe />
          <LayoutElement as="section" id="sales" kind="group">
            <LayoutElement as="article" id="revenue" kind="widget" parentId="sales">
              Revenue
            </LayoutElement>
          </LayoutElement>
        </LayoutRegistryProvider>
      </StrictMode>,
    )

    const group = screen.getByText('Revenue')
    expect(group?.dataset.layoutElement).toBe('true')
    expect(group?.dataset.layoutId).toBe('revenue')
    expect(group?.dataset.layoutKind).toBe('widget')
    expect(group?.dataset.layoutParentId).toBe('sales')
    await waitFor(() => expect(screen.getByTestId('snapshot').textContent).toBe('sales,revenue'))

    view.unmount()
    expect(document.body.textContent).toBe('')
  })

  it('isolates registries between providers', () => {
    render(
      <>
        <LayoutRegistryProvider>
          <SnapshotProbe />
          <LayoutElement id="first" kind="widget" />
        </LayoutRegistryProvider>
        <LayoutRegistryProvider>
          <SnapshotProbe />
          <LayoutElement id="second" kind="widget" />
        </LayoutRegistryProvider>
      </>,
    )

    expect(screen.getAllByTestId('snapshot').map((node) => node.textContent)).toEqual(['first', 'second'])
  })
})
