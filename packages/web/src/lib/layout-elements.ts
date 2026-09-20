export const LAYOUT_ELEMENT_KINDS = ['widget', 'group'] as const

import type { PageComponentContract } from '@/page-layout/definitions'
import {
  normalizeLayoutPolicy,
  type LayoutConstraintIssue,
  type LayoutConstraintPolicy,
  type LayoutOperationResult,
} from '@/page-layout/constraints'

export type LayoutElementKind = (typeof LAYOUT_ELEMENT_KINDS)[number]

/** The canonical node stored by the layout tree. */
export type LayoutNode = {
  id: string
  parentId: string | null
  children: string[]
  kind: LayoutElementKind
  zoneId?: string
  policy?: LayoutConstraintPolicy
  requiredZone?: boolean
}

/** Component registration input. Root nodes may omit parentId for compatibility. */
export type LayoutElementDescriptor = {
  id: string
  kind: LayoutElementKind
  parentId?: string | null
  zoneId?: string
  contract?: PageComponentContract
  requiredZone?: boolean
}

/** A node plus the projection metadata needed by the React layout surface. */
export type RegisteredLayoutElement = LayoutNode & {
  order: number
  domNode?: Element
}

export type LayoutRegistryOperationResult = LayoutOperationResult<readonly RegisteredLayoutElement[]>

/** Legacy move shape retained for the dnd surface while it migrates to index operations. */
export type LayoutMove = {
  id: string
  targetId: string | null
  position: 'before' | 'after'
  /** Destination parent. Omit to keep the source parent. */
  parentId?: string | null
}

export type LayoutRegistryListener = () => void

type PendingLayoutElement = { descriptor: LayoutElementDescriptor; unregister?: () => void }
type CreateNodeInput = LayoutElementDescriptor | LayoutNode

const isLayoutElementKind = (value: unknown): value is LayoutElementKind =>
  typeof value === 'string' && (LAYOUT_ELEMENT_KINDS as readonly string[]).includes(value)

const normalizeParentId = (parentId: string | null | undefined): string | null => parentId ?? null

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
  if (descriptor.parentId !== undefined && descriptor.parentId !== null &&
      (typeof descriptor.parentId !== 'string' || descriptor.parentId.trim() === '')) {
    throw new Error('Layout element parentId must be a non-empty string when provided')
  }
  if (descriptor.parentId === descriptor.id) {
    throw new Error(`Layout element "${descriptor.id}" cannot be its own parent`)
  }
}

const cloneElement = (element: RegisteredLayoutElement): RegisteredLayoutElement => ({
  ...element,
  children: [...element.children],
  ...(element.policy === undefined
    ? {}
    : {
        policy: Object.freeze({
          ...element.policy,
          ...(element.policy.allowedZones === undefined ? {} : { allowedZones: Object.freeze([...element.policy.allowedZones]) }),
        }),
      }),
})

/**
 * In-memory source of truth for one editable layout.
 *
 * Every registered element is one node. Parent/child links and sibling order are kept in that
 * node graph; the DOM is optional projection metadata and is never used to discover identity.
 */
export class LayoutRegistry {
  private readonly nodes = new Map<string, LayoutNode>()
  private readonly pendingElements = new Map<string, PendingLayoutElement>()
  private readonly pendingRemovals = new Set<string>()
  private readonly removedIds = new Set<string>()
  private readonly domNodes = new Map<string, Element>()
  private rootChildren: string[] = []
  private readonly listeners = new Set<LayoutRegistryListener>()
  private snapshotCache: RegisteredLayoutElement[] = []

  /** Create and register one node at the end of its destination sibling list. */
  createNode(input: CreateNodeInput): LayoutNode
  createNode(id: string, kind: LayoutElementKind, parentId?: string | null): LayoutNode
  createNode(
    inputOrId: CreateNodeInput | string,
    kind?: LayoutElementKind,
    parentId?: string | null,
  ): LayoutNode {
    const descriptor: LayoutElementDescriptor = typeof inputOrId === 'string'
      ? { id: inputOrId, kind: kind as LayoutElementKind, parentId }
      : inputOrId
    this.addNode(descriptor)
    this.promotePendingChildren(descriptor.id)
    this.rebuildSnapshot()
    return this.getNode(descriptor.id)!
  }

  register(descriptor: LayoutElementDescriptor): () => void {
    assertDescriptor(descriptor)
    if (this.nodes.has(descriptor.id)) {
      throw new Error(`Layout element "${descriptor.id}" is already registered`)
    }
    if (descriptor.parentId !== undefined && descriptor.parentId !== null && !this.nodes.has(descriptor.parentId)) {
      throw new Error(`Layout element parent "${descriptor.parentId}" is not registered`)
    }

    this.addNode(descriptor)
    this.promotePendingChildren(descriptor.id)
    this.rebuildSnapshot()
    return this.createUnregisterHandle(descriptor.id)
  }

  /**
   * React effects can mount a child before its parent. Such entries are promoted into the same
   * tree as soon as their parent appears, without making declaration order part of the API.
   */
  registerDeferred(descriptor: LayoutElementDescriptor): () => void {
    assertDescriptor(descriptor)
    if (this.nodes.has(descriptor.id) || this.pendingElements.has(descriptor.id)) {
      throw new Error(`Layout element "${descriptor.id}" is already registered`)
    }
    if (descriptor.parentId === undefined || descriptor.parentId === null || this.nodes.has(descriptor.parentId)) {
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
    if (!this.nodes.has(id) && !this.pendingElements.has(id)) {
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

  /** Read the canonical tree node without exposing mutable registry state. */
  getNode(id: string): LayoutNode | undefined {
    const node = this.nodes.get(id)
    return node ? cloneNode(node) : undefined
  }

  /** Returns true after an explicit delete until the same id is mounted again. */
  isRemoved(id: string): boolean {
    return this.removedIds.has(id)
  }

  /** Return the policy issues that would reject removing the selected subtree. */
  getRemovalIssues(id: string): readonly LayoutConstraintIssue[] {
    const ids = this.getSubtreeIds(id)
    if (ids.size === 0 || (!this.nodes.has(id) && !this.pendingElements.has(id))) return Object.freeze([])
    return this.removeIssues(ids)
  }

  /** Remove the selected node and its complete registered subtree in one notification. */
  removeNode(id: string): boolean {
    return this.tryRemoveNode(id).applied
  }

  tryRemoveNode(id: string): LayoutRegistryOperationResult {
    if (!this.nodes.has(id) && !this.pendingElements.has(id)) return { applied: false, issues: Object.freeze([]) }

    const ids = this.getSubtreeIds(id)
    const issues = this.removeIssues(ids)
    if (issues.length > 0) return { applied: false, issues }
    for (const removedId of ids) this.removedIds.add(removedId)

    const root = this.nodes.get(id)
    if (root) this.detachFromParent(root.parentId, id)
    for (const removedId of ids) {
      this.nodes.delete(removedId)
      this.pendingElements.delete(removedId)
      this.domNodes.delete(removedId)
      this.pendingRemovals.delete(removedId)
    }
    this.rebuildSnapshot()
    return { applied: true, snapshot: this.getSnapshot() }
  }

  /** Compatibility alias for callers that used the earlier subtree-specific name. */
  removeSubtree(id: string): boolean {
    return this.removeNode(id)
  }

  /** Move a node to an exact sibling index under a new parent (or at the root for null). */
  moveNode(id: string, newParentId: string | null, index: number): boolean {
    return this.tryMoveNode(id, newParentId, index).applied
  }

  tryMoveNode(id: string, newParentId: string | null, index: number, destinationZoneId?: string): LayoutRegistryOperationResult {
    const source = this.nodes.get(id)
    const parent = newParentId === null ? undefined : this.nodes.get(newParentId)
    if (!source || (newParentId !== null && !parent)) return { applied: false, issues: Object.freeze([]) }
    if (!Number.isInteger(index) || index < 0) return { applied: false, issues: Object.freeze([]) }
    if (newParentId !== null && this.getSubtreeIds(id).has(newParentId)) return { applied: false, issues: Object.freeze([]) }

    const sourceSiblings = this.siblingsFor(source.parentId)
    const destinationSiblings = this.siblingsFor(newParentId)
    const nextDestination = source.parentId === newParentId
      ? sourceSiblings.filter((siblingId) => siblingId !== id)
      : [...destinationSiblings]
    if (index > nextDestination.length) return { applied: false, issues: Object.freeze([]) }
    nextDestination.splice(index, 0, id)

    const unchanged = source.parentId === newParentId && nextDestination.every((siblingId, position) => siblingId === sourceSiblings[position])
    if (unchanged) return { applied: false, issues: Object.freeze([]) }

    const destinationZone = destinationZoneId ?? parent?.zoneId ?? source.zoneId
    const issues: LayoutConstraintIssue[] = []
    for (const element of this.getSubtree(id)) {
      if (element.policy === undefined) continue
      if (!element.policy.movable) issues.push(Object.freeze({ code: 'not-movable', key: element.id, zone: element.zoneId ?? '' }))
      if (destinationZone !== undefined && element.policy.allowedZones !== undefined && !element.policy.allowedZones.includes(destinationZone)) {
        issues.push(Object.freeze({ code: 'zone-not-allowed', key: element.id, zone: destinationZone }))
      }
    }
    const uniqueIssues = freezeRegistryIssues(issues)
    if (uniqueIssues.length > 0) return { applied: false, issues: uniqueIssues }

    this.applyMove(source, newParentId, sourceSiblings, nextDestination)
    return { applied: true, snapshot: this.getSnapshot() }
  }

  canMoveToZone(id: string, zoneId: string): boolean {
    const source = this.nodes.get(id)
    if (!source) return false
    return this.getSubtree(id).every((element) => {
      if (element.policy === undefined) return true
      return element.policy.movable && (element.policy.allowedZones === undefined || element.policy.allowedZones.includes(zoneId))
    })
  }

  private applyMove(source: LayoutNode, newParentId: string | null, sourceSiblings: string[], nextDestination: string[]): void {
    if (source.parentId !== newParentId) {
      this.setSiblings(source.parentId, sourceSiblings.filter((siblingId) => siblingId !== source.id))
    }
    this.setSiblings(newParentId, nextDestination)
    this.nodes.set(source.id, { ...source, parentId: newParentId })
    this.rebuildSnapshot()
  }

  /** Reorder a node within its existing parent. */
  reorderNode(id: string, index: number): boolean {
    const source = this.nodes.get(id)
    return source ? this.moveNode(id, source.parentId, index) : false
  }

  getChildren(parentId?: string | null): RegisteredLayoutElement[] {
    return this.siblingsFor(normalizeParentId(parentId)).map((id) => this.get(id)).filter((item): item is RegisteredLayoutElement => Boolean(item))
  }

  getSiblingIds(parentId?: string | null): string[] {
    return [...this.siblingsFor(normalizeParentId(parentId))]
  }

  /** Compatibility adapter for the old before/after drag operation. */
  moveWithinParent(move: LayoutMove): boolean {
    const source = this.nodes.get(move.id)
    const destinationParent = move.parentId === undefined ? source?.parentId : normalizeParentId(move.parentId)
    return Boolean(source) && destinationParent === source?.parentId ? this.moveLegacy(move, destinationParent!) : false
  }

  /** Compatibility adapter for cross-parent drag callers. */
  moveToParent(move: LayoutMove): boolean {
    const source = this.nodes.get(move.id)
    if (!source) return false
    const destinationParent = move.parentId === undefined
      ? this.nodes.get(move.targetId ?? '')?.parentId ?? source.parentId
      : normalizeParentId(move.parentId)
    return this.moveLegacy(move, destinationParent)
  }

  private moveLegacy(move: LayoutMove, destinationParent: string | null): boolean {
    const source = this.nodes.get(move.id)
    if (!source || move.targetId === move.id) return false
    if (destinationParent !== null && !this.nodes.has(destinationParent)) return false
    if (destinationParent !== null && this.getSubtreeIds(move.id).has(destinationParent)) return false

    const destinationSiblings = this.siblingsFor(destinationParent)
    const targetIndex = move.targetId === null ? destinationSiblings.length : destinationSiblings.indexOf(move.targetId)
    if (targetIndex < 0) return false
    if (move.targetId !== null && this.nodes.get(move.targetId)?.parentId !== destinationParent) return false

    const sourceSiblings = this.siblingsFor(source.parentId)
    const withoutSource = source.parentId === destinationParent
      ? sourceSiblings.filter((id) => id !== source.id)
      : destinationSiblings
    const adjustedTargetIndex = move.targetId === null
      ? withoutSource.length
      : withoutSource.indexOf(move.targetId) + (move.position === 'after' ? 1 : 0)
    if (adjustedTargetIndex < 0) return false
    return this.moveNode(source.id, destinationParent, adjustedTargetIndex)
  }

  getSubtree(id: string): RegisteredLayoutElement[] {
    const result: RegisteredLayoutElement[] = []
    const visit = (currentId: string) => {
      const current = this.get(currentId)
      if (!current) return
      result.push(current)
      for (const childId of current.children) visit(childId)
    }
    visit(id)
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

  private addNode(descriptor: LayoutElementDescriptor): void {
    assertDescriptor(descriptor)
    const parentId = normalizeParentId(descriptor.parentId)
    if (this.nodes.has(descriptor.id)) throw new Error(`Layout element "${descriptor.id}" is already registered`)
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new Error(`Layout element parent "${parentId}" is not registered`)
    }
    const policy = 'contract' in descriptor && descriptor.contract !== undefined
      ? normalizeLayoutPolicy(descriptor.contract)
      : (descriptor as LayoutNode).policy
    const node: LayoutNode = {
      id: descriptor.id,
      parentId,
      children: [],
      kind: descriptor.kind,
      ...(descriptor.zoneId === undefined ? {} : { zoneId: descriptor.zoneId }),
      ...(policy === undefined ? {} : { policy }),
      ...(descriptor.requiredZone === undefined ? {} : { requiredZone: descriptor.requiredZone }),
    }
    this.nodes.set(node.id, node)
    this.setSiblings(parentId, [...this.siblingsFor(parentId), node.id])
    this.removedIds.delete(node.id)
  }

  private registerForComponent(descriptor: LayoutElementDescriptor): () => void {
    this.register(descriptor)
    return this.createUnregisterHandle(descriptor.id, true)
  }

  private createUnregisterHandle(id: string, deferWhenChildren = false): () => void {
    let active = true
    return () => {
      if (!active) return
      if (this.nodes.has(id) && this.nodes.get(id)!.children.length > 0) {
        if (!deferWhenChildren) throw new Error(`Cannot unregister layout element "${id}" while it has children`)
        this.pendingRemovals.add(id)
        this.flushPendingRemovals()
        return
      }
      active = false
      if (this.nodes.has(id)) this.removeRegistered(id)
    }
  }

  private flushPendingRemovals(): void {
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...this.pendingRemovals]) {
        const node = this.nodes.get(id)
        if (node?.children.length) continue
        this.pendingRemovals.delete(id)
        if (node) {
          this.removeRegistered(id)
          changed = true
        }
      }
    }
  }

  private removeRegistered(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    this.detachFromParent(node.parentId, id)
    this.nodes.delete(id)
    this.domNodes.delete(id)
    this.rebuildSnapshot()
    this.flushPendingRemovals()
  }

  private promotePendingChildren(parentId: string): void {
    for (const entry of [...this.pendingElements.values()]) {
      if (normalizeParentId(entry.descriptor.parentId) !== parentId) continue
      this.pendingElements.delete(entry.descriptor.id)
      this.addNode(entry.descriptor)
      entry.unregister = this.createUnregisterHandle(entry.descriptor.id, true)
      this.promotePendingChildren(entry.descriptor.id)
    }
  }

  private getSubtreeIds(id: string): Set<string> {
    const result = new Set<string>()
    const visit = (currentId: string) => {
      if (result.has(currentId)) return
      result.add(currentId)
      for (const childId of this.nodes.get(currentId)?.children ?? []) visit(childId)
      for (const [pendingId, entry] of this.pendingElements) {
        if (normalizeParentId(entry.descriptor.parentId) === currentId) visit(pendingId)
      }
    }
    visit(id)
    return result
  }

  private siblingsFor(parentId: string | null): string[] {
    return parentId === null ? this.rootChildren : this.nodes.get(parentId)?.children ?? []
  }

  private setSiblings(parentId: string | null, children: string[]): void {
    if (parentId === null) this.rootChildren = children
    else {
      const parent = this.nodes.get(parentId)
      if (parent) this.nodes.set(parentId, { ...parent, children })
    }
  }

  private detachFromParent(parentId: string | null, id: string): void {
    this.setSiblings(parentId, this.siblingsFor(parentId).filter((childId) => childId !== id))
  }

  private rebuildSnapshot(): void {
    const next: RegisteredLayoutElement[] = []
    const visit = (id: string) => {
      const node = this.nodes.get(id)
      if (!node) return
      next.push({
        ...node,
        children: [...node.children],
        order: this.siblingsFor(node.parentId).indexOf(id),
        ...(this.domNodes.has(id) ? { domNode: this.domNodes.get(id) } : {}),
      })
      for (const childId of node.children) visit(childId)
    }
    for (const rootId of this.rootChildren) visit(rootId)
    this.snapshotCache = next
    for (const listener of this.listeners) listener()
  }

  private removeIssues(ids: Set<string>): readonly LayoutConstraintIssue[] {
    const issues: LayoutConstraintIssue[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (!node?.policy) continue
      if (!node.policy.removable) issues.push(Object.freeze({ code: 'not-removable', key: node.id, zone: node.zoneId ?? '' }))
      if (node.requiredZone && node.zoneId !== undefined) {
        const remaining = [...this.nodes.values()].some((candidate) => candidate.id !== id && !ids.has(candidate.id) && candidate.zoneId === node.zoneId)
        if (!remaining) issues.push(Object.freeze({ code: 'required-component', key: node.id, zone: node.zoneId }))
      }
    }
    return freezeRegistryIssues(issues)
  }
}

function cloneNode(node: LayoutNode): LayoutNode {
  return {
    ...node,
    children: [...node.children],
    ...(node.policy === undefined ? {} : { policy: clonePolicy(node.policy) }),
  }
}

function clonePolicy(policy: LayoutConstraintPolicy): LayoutConstraintPolicy {
  return Object.freeze({
    ...policy,
    ...(policy.allowedZones === undefined ? {} : { allowedZones: Object.freeze([...policy.allowedZones]) }),
  })
}

function freezeRegistryIssues(issues: readonly LayoutConstraintIssue[]): readonly LayoutConstraintIssue[] {
  const unique = new Map<string, LayoutConstraintIssue>()
  for (const issue of issues) unique.set(`${issue.code}:${issue.key}:${issue.zone}`, issue)
  return Object.freeze([...unique.values()])
}

export const createLayoutRegistry = (): LayoutRegistry => new LayoutRegistry()
