import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { defineComponentContract } from '@open-mercato/cezar-extension-api'

import { createPageLayoutRegistry, definePage, PageLayoutProvider } from './index'
import { LayoutRenderer } from './layout-renderer'
import type { TaskLayoutSnapshot, ValidatedLayoutBinding } from './layout-types'

afterEach(cleanup)

const Header = defineComponentContract<{ readonly label: string }>('cezar.fixture.layout-header', { version: 1 })
const Card = defineComponentContract<{ readonly label: string }>('cezar.fixture.layout-card', { version: 1 })

const snapshot = (zones: Record<string, readonly { id: string; contract: string; contractVersion: number }[]>): TaskLayoutSnapshot => ({
  identity: 'run-1',
  source: 'supplied',
  diagnostics: [],
  schema: { page: 'fixture.page', schemaVersion: 1, zones },
})

function renderLayout(layout: TaskLayoutSnapshot, bindings: readonly ValidatedLayoutBinding<null>[]) {
  const registry = createPageLayoutRegistry()
  registry.registerPage(definePage({
    id: 'fixture.page',
    version: 1,
    zones: [
      { id: 'fixture.header', placement: 'fixture.header', accepts: [Header], cardinality: 'single', required: true },
      { id: 'fixture.cards', placement: 'fixture.cards', accepts: [Card], cardinality: 'many', required: false },
    ],
  }))
  return render(
    <PageLayoutProvider registry={registry}>
      <LayoutRenderer snapshot={layout} context={null} bindings={bindings} />
    </PageLayoutProvider>,
  )
}

describe('LayoutRenderer', () => {
  it('uses serialized zone and placement order and stable subjects', () => {
    const bindings: readonly ValidatedLayoutBinding<null>[] = [
      { kind: 'header', schemaZone: 'fixture.header', pageZone: 'fixture.header', placement: 'fixture.header', contractId: Header.id, contractVersion: 1, render: ({ placement, subject }) => <span>{`${placement.id}:${subject}`}</span> },
      { kind: 'card', schemaZone: 'fixture.cards', pageZone: 'fixture.cards', placement: 'fixture.cards', contractId: Card.id, contractVersion: 1, render: ({ placement, subject }) => <span>{`${placement.id}:${subject}`}</span> },
    ]
    renderLayout(snapshot({
      'fixture.cards': [{ id: 'second', contract: Card.id, contractVersion: 1 }, { id: 'first', contract: Card.id, contractVersion: 1 }],
      'fixture.header': [{ id: 'head', contract: Header.id, contractVersion: 1 }],
    }), bindings)

    expect([...document.querySelectorAll('[data-placement-id]')].map((node) => node.textContent)).toEqual([
      'second:task:run-1:fixture.cards:second',
      'first:task:run-1:fixture.cards:first',
      'head:task:run-1:fixture.header:head',
    ])
  })

  it('keeps the first accepted placement in a single zone and omits empty optional zones', () => {
    const bindings: readonly ValidatedLayoutBinding<null>[] = [
      { kind: 'header', schemaZone: 'fixture.header', pageZone: 'fixture.header', placement: 'fixture.header', contractId: Header.id, contractVersion: 1, render: ({ placement }) => <span>{placement.id}</span> },
    ]
    renderLayout(snapshot({ 'fixture.header': [
      { id: 'first', contract: Header.id, contractVersion: 1 },
      { id: 'second', contract: Header.id, contractVersion: 1 },
    ], 'fixture.cards': [] }), bindings)

    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.queryByText('second')).toBeNull()
    expect(document.querySelector('[data-zone-id="fixture.cards"]')).toBeNull()
  })

  it('does not render an accepted placement when its binding is missing', () => {
    renderLayout(snapshot({ 'fixture.header': [{ id: 'head', contract: Header.id, contractVersion: 1 }], 'fixture.cards': [] }), [])

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(document.querySelector('[data-placement-id]')).toBeNull()
  })
})
