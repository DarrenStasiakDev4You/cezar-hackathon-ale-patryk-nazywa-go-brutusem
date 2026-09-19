export const LAYOUT_ELEMENT_KINDS = ['widget', 'group'] as const

export type LayoutElementKind = (typeof LAYOUT_ELEMENT_KINDS)[number]

export type LayoutElementDescriptor = {
  id: string
  kind: LayoutElementKind
  parentId?: string
}

export type RegisteredLayoutElement = LayoutElementDescriptor & {
  children: string[]
  order: number
  domNode?: Element
}

export type LayoutMove = {
  id: string
  targetId: string | null
  position: 'before' | 'after'
}

export type LayoutRegistryListener = () => void

type PendingLayoutElement = { descriptor: LayoutElementDescriptor; unregister?: () => void }

const isLayoutElementKind = (value: unknown): value is LayoutElementKind =>
  typeof value === 'string' && (LAYOUT_ELEMENT_KINDS as readonly string[]).includes(value)

const assertDescriptor = (descriptor: LayoutElementDescriptor): void => {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('A layout element descriptor is required')
  }
  if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
    throw new Error('Layout element id must be a non-empty string')
  }
  if (!isLayoutElementKind(descriptor.kind)) {
    throw new Error(`Unknown layout element kind: ${String(descriptor.kind)}`)
  }
  if (descriptor.parentId !== undefined && (typeof descriptor.parentId !== 'string' || descriptor.parentId.trim() === '')) {
    throw new Error('Layout element parentId must be a non-empty string when provided')
  }
  if (descriptor.parentId === descriptor.id) {
    throw new Error(`Layout element "${descriptor.id}" cannot be its own parent`)
  }
}

const cloneElement = (element: RegisteredLayoutElement): RegisteredLayoutElement => ({
  ...element,
  children: [...element.children],
})

/**
 * In-memory source of truth for one dashboard layout.
 *
 * DOM nodes are deliberately optional metadata: the tree remains useful while a visual
 * representation is temporarily unmounted, and consumers never need to scan the document.
 */
export class LayoutRegistry {
  private readonly elements = new Map<string, LayoutElementDescriptor>()
  private readonly pendingElements = new Map<string, PendingLayoutElement>()
  private readonly pendingRemovals = new Set<string>()
  private readonly domNodes = new Map<string, Element>()
  private readonly siblingOrder = new Map<string | undefined, string[]>()
  private readonly listeners = new Set<LayoutRegistryListener>()
  private snapshotCache: RegisteredLayoutElement[] = []

  register(descriptor: LayoutElementDescriptor): () => void {
    assertDescriptor(descriptor)
    if (this.elements.has(descriptor.id)) {
      throw new Error(`Layout element "${descriptor.id}" is already registered`)
    }
    if (descriptor.parentId !== undefined && !this.elements.has(descriptor.parentId)) {
      throw new Error(`Layout element parent "${descriptor.parentId}" is not registered`)
    }

    this.elements.set(descriptor.id, { ...descriptor })
    const siblings = this.siblingOrder.get(descriptor.parentId) ?? []
    this.siblingOrder.set(descriptor.parentId, [...siblings, descriptor.id])
    this.rebuildSnapshot()
    this.promotePendingChildren(descriptor.id)
    let active = true
    return () => {
      if (!active) return
      // Check before spending the handle: a refused unregister must stay retryable.
      if (this.getChildren(descriptor.id).length > 0) {
        throw new Error(`Cannot unregister layout element "${descriptor.id}" while it has children`)
      }
      active = false
      this.removeRegistered(descriptor.id)
    }
  }

  /**
   * React effects mount children before parents in some trees. Components use this lifecycle-safe
   * variant so declaration order does not become a runtime failure; unresolved entries stay out of
   * snapshots until their parent is registered. Direct registry callers still get strict validation
   * from register().
   */
  registerDeferred(descriptor: LayoutElementDescriptor): () => void {
    assertDescriptor(descriptor)
    if (this.elements.has(descriptor.id) || this.pendingElements.has(descriptor.id)) {
      throw new Error(`Layout element "${descriptor.id}" is already registered`)
    }
    if (descriptor.parentId === undefined || this.elements.has(descriptor.parentId)) {
      return this.registerForComponent(descriptor)
    }
    const entry: PendingLayoutElement = { descriptor: { ...descriptor } }
    this.pendingElements.set(descriptor.id, entry)
    return () => {
      entry.unregister?.()
      if (this.pendingElements.get(descriptor.id) === entry) this.pendingElements.delete(descriptor.id)
    }
  }

  attachDomNode(id: string, node: Element): () => void {
    if (!this.elements.has(id) && !this.pendingElements.has(id)) {
      throw new Error(`Cannot attach a DOM node to unknown layout element "${id}"`)
    }
    this.domNodes.set(id, node)
    this.rebuildSnapshot()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.domNodes.get(id) === node) {
        this.domNodes.delete(id)
        this.rebuildSnapshot()
      }
    }
  }

  get(id: string): RegisteredLayoutElement | undefined {
    const element = this.snapshotCache.find((candidate) => candidate.id === id)
    return element ? cloneElement(element) : undefined
  }

  getChildren(id?: string): RegisteredLayoutElement[] {
    return this.snapshotCache.filter((element) => element.parentId === id).map(cloneElement)
  }

  getSiblingIds(parentId?: string): string[] {
    return [...(this.siblingOrder.get(parentId) ?? [])]
  }

  /**
   * Moves one entry within its current parent without mutating the caller's move or snapshot.
   * Children never become targets across parent boundaries, and a group cannot be moved into
   * its own subtree.
   */
  moveWithinParent(move: LayoutMove): boolean {
    const source = this.elements.get(move.id)
    if (!source || (move.targetId !== null && move.targetId === move.id)) return false

    const siblings = this.siblingOrder.get(source.parentId)
    if (!siblings) return false

    const target = move.targetId === null ? undefined : this.elements.get(move.targetId)
    if (move.targetId !== null && (!target || target.parentId !== source.parentId)) return false
    if (target && this.getSubtreeIds(move.id).has(target.id)) return false

    const next = siblings.filter((id) => id !== move.id)
    const targetIndex = move.targetId === null ? next.length : next.indexOf(move.targetId)
    if (targetIndex < 0) return false
    const insertionIndex = move.targetId === null
      ? next.length
      : targetIndex + (move.position === 'after' ? 1 : 0)
    const currentIndex = siblings.indexOf(move.id)
    if (currentIndex < 0 || insertionIndex === currentIndex || insertionIndex === currentIndex + 1) {
      return false
    }

    next.splice(insertionIndex, 0, move.id)
    this.siblingOrder.set(source.parentId, next)
    this.rebuildSnapshot()
    return true
  }

  getSubtree(id: string): RegisteredLayoutElement[] {
    const root = this.get(id)
    if (!root) return []
    const result: RegisteredLayoutElement[] = []
    const visit = (element: RegisteredLayoutElement) => {
      result.push(element)
      for (const child of this.getChildren(element.id)) visit(child)
    }
    visit(root)
    return result
  }

  getSnapshot(): RegisteredLayoutElement[] {
    return this.snapshotCache.map(cloneElement)
  }

  getExternalSnapshot(): RegisteredLayoutElement[] {
    return this.snapshotCache
  }

  subscribe(listener: LayoutRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private rebuildSnapshot(): void {
    const childrenByParent = new Map<string | undefined, string[]>()
    for (const [parentId, ids] of this.siblingOrder) {
      childrenByParent.set(parentId, [...ids])
    }
    this.snapshotCache = [...this.elements.values()].map((descriptor) => ({
      ...descriptor,
      children: [...(childrenByParent.get(descriptor.id) ?? [])],
      order: this.siblingOrder.get(descriptor.parentId)?.indexOf(descriptor.id) ?? -1,
      ...(this.domNodes.has(descriptor.id) ? { domNode: this.domNodes.get(descriptor.id) } : {}),
    }))
    for (const listener of this.listeners) listener()
  }

  private promotePendingChildren(parentId: string): void {
    for (const entry of [...this.pendingElements.values()]) {
      if (entry.descriptor.parentId !== parentId) continue
      this.pendingElements.delete(entry.descriptor.id)
      entry.unregister = this.registerForComponent(entry.descriptor)
      this.promotePendingChildren(entry.descriptor.id)
    }
  }

  private registerForComponent(descriptor: LayoutElementDescriptor): () => void {
    this.register(descriptor)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.pendingRemovals.add(descriptor.id)
      this.flushPendingRemovals()
    }
  }

  private flushPendingRemovals(): void {
    for (const id of [...this.pendingRemovals]) {
      if (this.getChildren(id).length > 0) continue
      this.pendingRemovals.delete(id)
      if (this.elements.has(id)) this.removeRegistered(id)
    }
  }

  private removeRegistered(id: string): void {
    const descriptor = this.elements.get(id)
    this.elements.delete(id)
    this.domNodes.delete(id)
    if (descriptor) {
      const siblings = this.siblingOrder.get(descriptor.parentId)
      if (siblings) {
        const next = siblings.filter((siblingId) => siblingId !== id)
        if (next.length > 0) this.siblingOrder.set(descriptor.parentId, next)
        else this.siblingOrder.delete(descriptor.parentId)
      }
    }
    this.rebuildSnapshot()
    this.flushPendingRemovals()
  }

  private getSubtreeIds(id: string): Set<string> {
    const result = new Set<string>()
    const visit = (currentId: string) => {
      if (result.has(currentId)) return
      result.add(currentId)
      for (const childId of this.siblingOrder.get(currentId) ?? []) visit(childId)
    }
    visit(id)
    return result
  }
}

export const createLayoutRegistry = (): LayoutRegistry => new LayoutRegistry()
