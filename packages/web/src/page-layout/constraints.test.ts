import { describe, expect, it } from 'vitest'

import { defineComponentContract } from '@open-mercato/cezar-extension-api'

import { definePage, type PageContent } from './definitions'
import { validateLayoutOperation } from './constraints'

const Movable = defineComponentContract('cezar.fixture.movable', {
  version: 1,
  movable: true,
  removable: true,
  replaceable: true,
  allowedZones: ['fixture.main', 'fixture.sidebar'],
  category: 'fixture.card',
})
const Fixed = defineComponentContract('cezar.fixture.fixed', { version: 1 })
const NotReplaceable = defineComponentContract('cezar.fixture.not-replaceable', { version: 1, replaceable: false })
const Replacement = defineComponentContract('cezar.fixture.replacement', { version: 1 })

const page = definePage({
  id: 'fixture.constraints',
  version: 1,
  zones: [
    { id: 'fixture.main', placement: 'fixture.content', accepts: [Movable, Fixed, NotReplaceable], cardinality: 'many', required: true },
    { id: 'fixture.sidebar', placement: 'fixture.content', accepts: [Movable], cardinality: 'many', required: true },
    { id: 'fixture.header', placement: 'fixture.header', accepts: [Replacement], cardinality: 'single', required: false },
  ],
})

const content = (items: PageContent['zones']): PageContent => ({ pageId: page.id, zones: items })

describe('validateLayoutOperation', () => {
  it('accepts a movable item in each allowed zone and returns a frozen empty result', () => {
    const issues = validateLayoutOperation({
      page,
      content: content({ 'fixture.main': [{ key: 'card', placement: 'fixture.content', contract: Movable, props: {} }] }),
      operation: { kind: 'move', key: 'card', fromZone: 'fixture.main', toZone: 'fixture.sidebar' },
    })

    expect(issues).toEqual([])
    expect(Object.isFrozen(issues)).toBe(true)
  })

  it('reports stable, typed issues for a forbidden move without mutating content', () => {
    const current = content({ 'fixture.main': [{ key: 'card', placement: 'fixture.content', contract: Movable, props: {} }] })
    const issues = validateLayoutOperation({
      page,
      content: current,
      operation: { kind: 'move', key: 'card', fromZone: 'fixture.main', toZone: 'fixture.header' },
    })

    expect(issues).toEqual([{ code: 'zone-not-allowed', key: 'card', zone: 'fixture.header' }])
    expect(current.zones['fixture.main']).toHaveLength(1)
  })

  it('rejects non-movable moves and protects the last usable item in a required zone', () => {
    const fixedContent = content({
      'fixture.main': [{ key: 'fixed', placement: 'fixture.content', contract: Fixed, props: {} }],
      'fixture.sidebar': [{ key: 'card', placement: 'fixture.content', contract: Movable, props: {} }],
    })

    expect(validateLayoutOperation({
      page,
      content: fixedContent,
      operation: { kind: 'move', key: 'fixed', fromZone: 'fixture.main', toZone: 'fixture.sidebar' },
    })).toEqual([
      { code: 'contract-not-accepted', key: 'fixed', zone: 'fixture.sidebar' },
      { code: 'not-movable', key: 'fixed', zone: 'fixture.main' },
    ])
    expect(validateLayoutOperation({
      page,
      content: fixedContent,
      operation: { kind: 'remove', key: 'card', zone: 'fixture.sidebar' },
    })).toEqual([{ code: 'required-component', key: 'card', zone: 'fixture.sidebar' }])
  })

  it('checks replacement policy and target contract admission separately', () => {
    const current = content({ 'fixture.main': [{ key: 'fixed', placement: 'fixture.content', contract: NotReplaceable, props: {} }] })

    expect(validateLayoutOperation({
      page,
      content: current,
      operation: { kind: 'replace', key: 'fixed', zone: 'fixture.main', contract: Replacement },
    })).toEqual([
      { code: 'contract-not-accepted', key: 'fixed', zone: 'fixture.main' },
      { code: 'not-replaceable', key: 'fixed', zone: 'fixture.main' },
    ])
  })
})
