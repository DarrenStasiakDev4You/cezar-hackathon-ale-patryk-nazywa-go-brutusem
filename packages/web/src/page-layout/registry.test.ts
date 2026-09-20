import { describe, expect, it, vi } from 'vitest'

import { defineComponentContract } from '@open-mercato/cezar-extension-api'

import { definePage, PageLayoutDefinitionError } from './definitions'
import { createPageLayoutRegistry } from './registry'

const Card = defineComponentContract<{ readonly label: string }>('cezar.fixture.card', { version: 1 })
const OtherCard = defineComponentContract<{ readonly label: string }>('cezar.fixture.other-card', { version: 1 })

const page = () =>
  definePage({
    id: 'fixture.page',
    version: 1,
    zones: [
      { id: 'fixture.required', accepts: [Card], cardinality: 'single', required: true },
      { id: 'fixture.optional', accepts: [OtherCard], cardinality: 'many', required: false },
    ],
  })

describe('page layout definitions', () => {
  it('freezes the page, zones and accepted contract metadata', () => {
    const definition = page()

    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.zones)).toBe(true)
    expect(Object.isFrozen(definition.zones[0])).toBe(true)
    expect(Object.isFrozen(definition.zones[0]?.accepts)).toBe(true)
    expect(definition.zones[0]?.accepts[0]).toMatchObject({ id: Card.id, version: 1 })
  })

  it('rejects duplicate zones and duplicate accepted contract versions', () => {
    expect(() =>
      definePage({
        id: 'fixture.page',
        version: 1,
        zones: [
          { id: 'fixture.zone', accepts: [Card, { ...Card }], cardinality: 'many', required: false },
          { id: 'fixture.zone', accepts: [], cardinality: 'many', required: false },
        ],
      }),
    ).toThrow(PageLayoutDefinitionError)
  })
})

describe('PageLayoutRegistry', () => {
  it('publishes immutable pages, revisions and disposal notifications', () => {
    const registry = createPageLayoutRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const handle = registry.registerPage(page())

    expect(registry.revision()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.listPages()).toEqual([page()])
    expect(registry.getZone('fixture.page', 'fixture.required')?.required).toBe(true)

    unsubscribe()
    handle.dispose()
    handle.dispose()
    expect(registry.revision()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.listPages()).toEqual([])
  })

  it('keeps the last valid snapshot when a later registration fails', () => {
    const registry = createPageLayoutRegistry()
    const definition = page()
    registry.registerPage(definition)

    expect(() => registry.registerPage(definition)).toThrow(/already registered/)
    expect(registry.getPage('fixture.page')).toEqual(definition)
    expect(registry.revision()).toBe(1)
  })

  it('validates page, zone, contract and cardinality rules without reordering content', () => {
    const registry = createPageLayoutRegistry()
    registry.registerPage(page())
    const issues = registry.validateContent({
      pageId: 'fixture.page',
      zones: {
        'fixture.required': [
          { key: 'first', contract: OtherCard, props: { label: 'wrong' } },
          { key: 'second', contract: Card, props: { label: 'too many' } },
        ],
        'fixture.unknown': [],
      },
    })

    expect(issues).toEqual(
      expect.arrayContaining([
        { code: 'unknown-zone', pageId: 'fixture.page', zoneId: 'fixture.unknown' },
        { code: 'cardinality-exceeded', zoneId: 'fixture.required' },
        { code: 'contract-not-accepted', zoneId: 'fixture.required', contractId: OtherCard.id, version: 1 },
      ]),
    )
    expect(registry.validateContent({ pageId: 'missing.page', zones: {} })).toEqual([
      { code: 'unknown-page', pageId: 'missing.page' },
    ])
  })
})
