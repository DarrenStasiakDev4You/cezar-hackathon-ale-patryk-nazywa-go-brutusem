import { describe, expect, it } from 'vitest'

import { LayoutRegistry } from './layout-elements'

describe('LayoutRegistry', () => {
  it('indexes roots, children, nested groups, and deterministic subtrees', () => {
    const registry = new LayoutRegistry()
    const unregisterRoot = registry.register({ id: 'sales', kind: 'group' })
    const unregisterRevenue = registry.register({ id: 'revenue', kind: 'widget', parentId: 'sales' })
    const unregisterBreakdown = registry.register({ id: 'breakdown', kind: 'group', parentId: 'sales' })
    const unregisterRegion = registry.register({ id: 'region', kind: 'widget', parentId: 'breakdown' })

    expect(registry.getChildren().map((item) => item.id)).toEqual(['sales'])
    expect(registry.getChildren('sales').map((item) => item.id)).toEqual(['revenue', 'breakdown'])
    expect(registry.getSubtree('sales').map((item) => item.id)).toEqual(['sales', 'revenue', 'breakdown', 'region'])
    expect(registry.get('revenue')).toMatchObject({ id: 'revenue', kind: 'widget', parentId: 'sales', children: [] })

    unregisterRegion()
    unregisterBreakdown()
    unregisterRevenue()
    unregisterRoot()
    expect(registry.getSnapshot()).toEqual([])
  })

  it('rejects invalid registrations without corrupting the existing index', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'sales', kind: 'group' })

    expect(() => registry.register({ id: 'sales', kind: 'widget' })).toThrow('already registered')
    expect(() => registry.register({ id: 'missing-child', kind: 'widget', parentId: 'missing' })).toThrow('not registered')
    expect(() => registry.register({ id: 'self', kind: 'group', parentId: 'self' })).toThrow('own parent')
    expect(() => registry.register({ id: 'bad', kind: 'not-a-kind' as never })).toThrow('Unknown layout element kind')
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(['sales'])
  })

  it('keeps a parent registered until all children are removed', () => {
    const registry = new LayoutRegistry()
    const unregisterParent = registry.register({ id: 'group', kind: 'group' })
    registry.register({ id: 'widget', kind: 'widget', parentId: 'group' })

    expect(() => unregisterParent()).toThrow('while it has children')
    expect(registry.get('group')).toBeDefined()
  })

  it('does not expose mutable registry state and tracks DOM nodes separately', () => {
    const registry = new LayoutRegistry()
    const unregister = registry.register({ id: 'widget', kind: 'widget' })
    const node = document.createElement('article')
    const detach = registry.attachDomNode('widget', node)
    const snapshot = registry.getSnapshot()
    snapshot[0]!.children.push('unexpected')
    snapshot[0]!.id = 'changed'

    expect(registry.get('widget')).toMatchObject({ id: 'widget', children: [], domNode: node })
    detach()
    expect(registry.get('widget')?.domNode).toBeUndefined()
    unregister()
  })
})
