import { describe, expect, it } from 'vitest'

import { LayoutRegistry, type LayoutElementDescriptor } from './layout-elements'

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

  it('lets a refused unregister succeed once the children are gone', () => {
    const registry = new LayoutRegistry()
    const unregisterParent = registry.register({ id: 'group', kind: 'group' })
    const unregisterChild = registry.register({ id: 'widget', kind: 'widget', parentId: 'group' })

    expect(() => unregisterParent()).toThrow('while it has children')
    unregisterChild()
    unregisterParent()
    expect(registry.getSnapshot()).toEqual([])
  })

  it('rejects an unknown kind at compile time', () => {
    // @ts-expect-error 'panel' is not a LayoutElementKind
    const descriptor: LayoutElementDescriptor = { id: 'panel', kind: 'panel' }
    expect(() => new LayoutRegistry().register(descriptor)).toThrow('Unknown layout element kind')
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

  it('keeps sibling order stable and rejects cross-parent moves through the local API', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'group', kind: 'group' })
    registry.register({ id: 'first', kind: 'widget' })
    registry.register({ id: 'second', kind: 'widget' })
    registry.register({ id: 'third', kind: 'widget' })
    registry.register({ id: 'nested', kind: 'group', parentId: 'group' })
    registry.register({ id: 'nested-child', kind: 'widget', parentId: 'nested' })

    expect(registry.getSiblingIds()).toEqual(['group', 'first', 'second', 'third'])
    expect(registry.moveWithinParent({ id: 'third', targetId: 'first', position: 'before' })).toBe(true)
    expect(registry.getSiblingIds()).toEqual(['group', 'third', 'first', 'second'])
    expect(registry.moveWithinParent({ id: 'second', targetId: null, position: 'after' })).toBe(false)
    expect(registry.moveWithinParent({ id: 'first', targetId: 'nested', position: 'after' })).toBe(false)
    expect(registry.getSiblingIds('nested')).toEqual(['nested-child'])
    expect(registry.get('nested')?.children).toEqual(['nested-child'])
  })

  it('publishes one immutable snapshot for a successful move', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'first', kind: 'widget' })
    registry.register({ id: 'second', kind: 'widget' })
    let notifications = 0
    registry.subscribe(() => notifications++)

    expect(registry.moveWithinParent({ id: 'second', targetId: 'first', position: 'before' })).toBe(true)
    expect(notifications).toBe(1)
    const snapshot = registry.getSnapshot()
    snapshot[0]!.children.push('not-real')
    snapshot[0]!.order = 99
    expect(registry.getSiblingIds()).toEqual(['second', 'first'])
    expect(registry.get('second')?.order).toBe(0)
  })

  it('rejects moving a group into its own subtree', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'root', kind: 'group' })
    registry.register({ id: 'child', kind: 'group', parentId: 'root' })
    registry.register({ id: 'grandchild', kind: 'widget', parentId: 'child' })

    expect(registry.moveWithinParent({ id: 'root', targetId: 'child', position: 'after' })).toBe(false)
    expect(registry.getSiblingIds()).toEqual(['root'])
  })

  it('moves an element to another parent atomically', () => {
    const registry = new LayoutRegistry()
    registry.register({ id: 'left', kind: 'group' })
    registry.register({ id: 'right', kind: 'group' })
    registry.register({ id: 'card', kind: 'widget', parentId: 'left' })
    registry.register({ id: 'other', kind: 'widget', parentId: 'right' })

    expect(registry.moveToParent({ id: 'card', targetId: 'other', position: 'before', parentId: 'right' })).toBe(true)
    expect(registry.get('card')?.parentId).toBe('right')
    expect(registry.getSiblingIds('left')).toEqual([])
    expect(registry.getSiblingIds('right')).toEqual(['card', 'other'])
  })
})
