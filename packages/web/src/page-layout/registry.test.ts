import { describe, expect, it, vi } from 'vitest'

import { defineComponentContract } from '@open-mercato/cezar-extension-api'

import { CORE_COMPONENT_CONTRACTS } from '@/component-registry/core-contracts'
import { createCoreComponentRegistry } from '@/component-registry/core-components'
import { missingCoreDefaults } from '@/component-registry/resolve'

import { definePage, PageLayoutDefinitionError } from './definitions'
import { TaskPage } from './core-pages'
import { createPageLayoutRegistry } from './registry'

const Card = defineComponentContract<{ readonly label: string }>('cezar.fixture.card', { version: 1 })
const OtherCard = defineComponentContract<{ readonly label: string }>('cezar.fixture.other-card', { version: 1 })

const page = () =>
  definePage({
    id: 'fixture.page',
    version: 1,
    zones: [
      { id: 'fixture.required', placement: 'fixture.content', accepts: [Card], cardinality: 'single', required: true },
      { id: 'fixture.optional', placement: 'fixture.panel', accepts: [OtherCard], cardinality: 'many', required: false },
    ],
  })

describe('page layout definitions', () => {
  it('declares Task Page zones and accepted contract metadata', () => {
    expect(TaskPage.zones.map((zone) => zone.id)).toEqual(['task.header', 'task.main', 'task.sidebar'])
    expect(TaskPage.zones.map((zone) => zone.placement)).toEqual([
      'task.header.main',
      'task.main.content',
      'task.sidebar.panel',
    ])
    expect(TaskPage.zones[0]?.accepts?.[0]).toMatchObject({ id: 'cezar.task.header.main', version: 1 })
    expect(TaskPage.zones[1]?.accepts?.[0]).toMatchObject({ id: 'cezar.task.composer', version: 1 })
    expect(TaskPage.zones[2]?.required).toBe(false)
  })

  it('keeps every narrow Task Page contract backed by a core default', () => {
    const narrowContracts = TaskPage.zones.flatMap((zone) => zone.accepts ?? [])

    expect(narrowContracts.map((contract) => contract.id).sort()).toEqual(CORE_COMPONENT_CONTRACTS.map((contract) => contract.id).sort())
    expect(missingCoreDefaults(createCoreComponentRegistry(), narrowContracts)).toEqual([])
  })

  it('freezes the page, zones and accepted contract metadata', () => {
    const definition = page()

    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.zones)).toBe(true)
    expect(Object.isFrozen(definition.zones[0])).toBe(true)
    expect(Object.isFrozen(definition.zones[0]?.accepts)).toBe(true)
    expect(definition.zones[0]?.accepts?.[0]).toMatchObject({ id: Card.id, version: 1 })
  })

  it('rejects duplicate zones and duplicate accepted contract versions', () => {
    expect(() =>
      definePage({
        id: 'fixture.page',
        version: 1,
        zones: [
          { id: 'fixture.zone', placement: 'fixture.content', accepts: [Card, { ...Card }], cardinality: 'many', required: false },
          { id: 'fixture.zone', placement: 'fixture.other', accepts: [], cardinality: 'many', required: false },
        ],
      }),
    ).toThrow(PageLayoutDefinitionError)
  })

  it('rejects malformed placement ids and layout metadata', () => {
    expect(() =>
      definePage({
        id: 'fixture.invalid-page',
        version: 1,
        zones: [
          {
            id: 'fixture.zone',
            placement: 'not valid',
            accepts: [Card],
            cardinality: 'many',
            required: false,
            layout: { minBlockSize: 2049 },
          },
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
          { key: 'first', placement: 'fixture.content', contract: OtherCard, props: { label: 'wrong' } },
          { key: 'second', placement: 'fixture.content', contract: Card, props: { label: 'too many' } },
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

  it('admits category-open zones and rejects content from another placement', () => {
    const registry = createPageLayoutRegistry()
    registry.registerPage(
      definePage({
        id: 'fixture.open-page',
        version: 1,
        zones: [{ id: 'fixture.open', placement: 'fixture.panel', cardinality: 'many', required: false }],
      }),
    )

    expect(
      registry.validateContent({
        pageId: 'fixture.open-page',
        zones: {
          'fixture.open': [{ key: 'future', placement: 'fixture.panel', contract: OtherCard, props: { label: 'future' } }],
        },
      }),
    ).toEqual([])
    expect(
      registry.validateContent({
        pageId: 'fixture.open-page',
        zones: {
          'fixture.open': [{ key: 'wrong', placement: 'fixture.other', contract: OtherCard, props: { label: 'wrong' } }],
        },
      }),
    ).toEqual([{ code: 'placement-not-accepted', zoneId: 'fixture.open', placement: 'fixture.other' }])
  })

  it('reports an empty required zone as a typed issue', () => {
    const registry = createPageLayoutRegistry()
    registry.registerPage(page())

    expect(registry.validateContent({ pageId: 'fixture.page', zones: {} })).toEqual([
      { code: 'required-zone-empty', zoneId: 'fixture.required' },
    ])
  })
})
