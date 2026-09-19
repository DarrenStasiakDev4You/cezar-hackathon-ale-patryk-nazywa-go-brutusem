import * as React from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { useLayoutRegistry, useLayoutSnapshot } from '@/components/layout-registry'
import { isEditModeActive } from '@/components/edit-mode-interaction-guard'
import type { LayoutElementDescriptor, LayoutMove, LayoutRegistry, RegisteredLayoutElement } from '@/lib/layout-elements'

type LayoutSortableContextValue = {
  enabled: boolean
  activeId: string | null
  dragMode: LayoutDragMode
  placeholder: LayoutPlaceholderState | null
}

export type LayoutDragMode = 'sortable' | 'container'
export type LayoutPlaceholderPlacement = 'before' | 'after'
export type LayoutPlaceholderState = {
  visible: boolean
  placement: LayoutPlaceholderPlacement | null
  order: number | null
}

const LayoutSortableContext = React.createContext<LayoutSortableContextValue>({
  enabled: false,
  activeId: null,
  dragMode: 'sortable',
  placeholder: null,
})

export function useLayoutSortableContext(): LayoutSortableContextValue {
  return React.useContext(LayoutSortableContext)
}

export type LayoutSortableSurfaceProps = {
  children: React.ReactNode
  enabled?: boolean
  className?: string
  /** Limit this surface to one layout container; useful when a page and the shell share a registry. */
  ids?: string[]
  /** Container surfaces drag their shell as one stable block; ordinary surfaces reorder siblings. */
  dragMode?: LayoutDragMode
  renderOverlay?: (element: RegisteredLayoutElement) => React.ReactNode
  onLayoutChange?: (snapshot: RegisteredLayoutElement[]) => void
}

export const layoutZoneId = (id: string): string => `layout-zone:${id}`

export function LayoutDropZone({ id, children, className, hitAreaClassName }: {
  id: string
  children: React.ReactNode
  className?: string
  hitAreaClassName?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: layoutZoneId(id) })
  const { activeId } = useLayoutSortableContext()
  const registry = useLayoutRegistry()
  const activeElement = activeId ? registry.get(activeId) : undefined
  const acceptsGroup = activeElement?.kind === 'group'
  return (
    <div
      className={className}
    >
      <div
        ref={setNodeRef}
        aria-hidden="true"
        className={acceptsGroup
          ? `pointer-events-auto ${hitAreaClassName ?? 'absolute inset-0 z-30 bg-primary/5'}`
          : 'pointer-events-none absolute inset-0'}
        data-layout-drop-zone={id}
        data-layout-drop-active={acceptsGroup && isOver ? 'true' : 'false'}
      />
      {children}
    </div>
  )
}

const elementLabel = (element: LayoutElementDescriptor): string => `${element.kind === 'group' ? 'Grupa' : 'Element'} ${element.id}`

type LayoutRect = { top: number; left: number; right: number; bottom: number; width: number; height: number }

const rectFromGeometry = (geometry: { top: number; left: number; width: number; height: number }): LayoutRect => ({
  top: geometry.top,
  left: geometry.left,
  right: geometry.left + geometry.width,
  bottom: geometry.top + geometry.height,
  width: geometry.width,
  height: geometry.height,
})

function surfaceRect(node: HTMLElement | null): LayoutRect | null {
  if (!node) return null
  const rect = node.getBoundingClientRect()
  if (rect.width !== 0 || rect.height !== 0) return rect
  const parentRect = node.parentElement?.getBoundingClientRect()
  return parentRect && (parentRect.width !== 0 || parentRect.height !== 0) ? parentRect : null
}

function placeholderOrder(registry: LayoutRegistry, activeId: string, placement: LayoutPlaceholderPlacement): number {
  const source = registry.get(activeId)
  if (!source) return placement === 'before' ? -1 : 0
  const siblingCount = registry.getSiblingIds(source.parentId).length
  return placement === 'before' ? -1 : siblingCount
}

export function resolveLayoutPlaceholderState({
  current,
  geometry,
  boundary,
  deltaX,
  deltaY,
  previousDeltaX,
  originId,
  registry,
}: {
  current: LayoutPlaceholderState | null
  geometry: { top: number; left: number; width: number; height: number }
  boundary: LayoutRect | null
  deltaX: number
  deltaY: number
  previousDeltaX: number
  originId: string
  registry: LayoutRegistry
}): LayoutPlaceholderState | null {
  if (!boundary || geometry.width === 0) return current

  const origin = rectFromGeometry(geometry)
  const translated = {
    ...origin,
    top: geometry.top + deltaY,
    bottom: geometry.top + deltaY + geometry.height,
    left: geometry.left + deltaX,
    right: geometry.left + deltaX + geometry.width,
  }
  const nearLeft = translated.left <= boundary.left + origin.width
  const nearRight = translated.right >= boundary.right - origin.width
  const overlapsOrigin =
    translated.left < origin.right &&
    translated.right > origin.left &&
    translated.top < origin.bottom &&
    translated.bottom > origin.top
  const originEdge: LayoutPlaceholderPlacement = origin.left + origin.width / 2 <= boundary.left + boundary.width / 2 ? 'before' : 'after'
  const deltaDirection = deltaX === previousDeltaX ? 0 : deltaX > previousDeltaX ? 1 : -1

  let next = current
  if (current?.visible) {
    const stillAtEdge = current.placement === 'before' ? nearLeft : current.placement === 'after' ? nearRight : overlapsOrigin
    if (!stillAtEdge) {
      next = overlapsOrigin
        ? { visible: true, placement: null, order: null }
        : { visible: false, placement: null, order: null }
    }
  } else if (nearLeft || nearRight) {
    const edge: LayoutPlaceholderPlacement = nearLeft && nearRight
      ? (deltaDirection < 0 ? 'before' : deltaDirection > 0 ? 'after' : originEdge)
      : nearLeft
        ? 'before'
        : 'after'
    next = {
      visible: true,
      placement: edge === originEdge ? null : edge,
      order: edge === originEdge ? null : placeholderOrder(registry, originId, edge),
    }
  }

  if (next?.visible === current?.visible && next?.placement === current?.placement && next?.order === current?.order) return current
  return next
}

export function resolveLayoutOverlayScale(placeholder: LayoutPlaceholderState | null): number {
  return placeholder?.visible ? 1 : 0.92
}

function LayoutDragOverlayPreview({ element, scale }: { element: RegisteredLayoutElement; scale: number }) {
  const previewRef = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    const source = element.domNode
    const preview = source?.cloneNode(true)
    if (!(preview instanceof HTMLElement) || !previewRef.current) return

    preview.removeAttribute('data-layout-placeholder')
    preview.setAttribute('data-layout-dragging', 'false')
    preview.style.display = ''
    preview.style.visibility = 'visible'
    preview.style.transform = ''
    preview.style.transition = 'none'
    preview.style.order = ''
    for (const placeholder of preview.querySelectorAll('[data-layout-placeholder]')) placeholder.remove()

    previewRef.current.replaceChildren(preview)
    return () => previewRef.current?.replaceChildren()
  }, [element])

  return (
    <div
      ref={previewRef}
      aria-hidden="true"
      data-layout-overlay-preview="true"
      data-layout-overlay-state={scale < 1 ? 'detached' : 'anchored'}
      style={{
        width: '100%',
        height: '100%',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        transition: 'transform 120ms ease',
        pointerEvents: 'none',
      }}
    />
  )
}

function useDetectedEditMode(): boolean {
  const [active, setActive] = React.useState(() => typeof document !== 'undefined' && isEditModeActive())

  React.useEffect(() => {
    const shell = document.querySelector('[data-slot="app-shell"]')
    if (!shell) return
    const update = () => setActive(isEditModeActive())
    update()
    const observer = new MutationObserver(update)
    observer.observe(shell, { attributes: true, attributeFilter: ['data-edit-mode'] })
    return () => observer.disconnect()
  }, [])

  return active
}

export function resolveLayoutMove(registry: LayoutRegistry, activeId: string, overId: string): LayoutMove | null {
  const source = registry.get(activeId)
  const target = registry.get(overId)
  if (!source || !target || source.id === target.id) return null

  const siblings = registry.getSiblingIds(source.parentId)
  const sourceIndex = siblings.indexOf(source.id)
  const targetIndex = siblings.indexOf(target.id)
  const sameParent = source.parentId === target.parentId
  // Ordinary elements are reorderable only among their current siblings. Groups are the
  // explicit cross-menu affordance; their complete subtree moves together.
  if (!sameParent && source.kind !== 'group') return null
  if (sameParent && (sourceIndex < 0 || targetIndex < 0)) return null

  return {
    id: source.id,
    targetId: target.id,
    position: sameParent && sourceIndex < targetIndex ? 'after' : 'before',
    ...(sameParent ? {} : { parentId: target.parentId ?? null }),
  }
}

export function LayoutSortableSurface({
  children,
  enabled,
  className,
  ids,
  dragMode = 'sortable',
  renderOverlay,
  onLayoutChange,
}: LayoutSortableSurfaceProps) {
  const registry = useLayoutRegistry()
  const snapshot = useLayoutSnapshot()
  const detectedEditMode = useDetectedEditMode()
  const isEnabled = enabled ?? detectedEditMode
  const sortableSnapshot = ids ? snapshot.filter((element) => ids.includes(element.id)) : snapshot
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const [activeGeometry, setActiveGeometry] = React.useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  const [placeholder, setPlaceholder] = React.useState<LayoutPlaceholderState | null>(null)
  const placeholderRef = React.useRef<LayoutPlaceholderState | null>(null)
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const lastDeltaX = React.useRef(0)
  const [liveMessage, setLiveMessage] = React.useState('')
  const activeElement = activeId ? registry.get(activeId) : undefined

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id = String(event.active.id)
    const element = registry.get(id)
    const rect = event.active.rect.current.initial
    setActiveId(id)
    setOverId(null)
    setActiveGeometry(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null)
    const nextPlaceholder = dragMode === 'container' ? { visible: true, placement: null, order: null } : null
    placeholderRef.current = nextPlaceholder
    setPlaceholder(nextPlaceholder)
    lastDeltaX.current = 0
    setLiveMessage(element ? `Podniesiono: ${elementLabel(element)}` : '')
  }, [dragMode, registry])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    if (dragMode === 'container' && activeId && activeGeometry) {
      const nextPlaceholder = resolveLayoutPlaceholderState({
        current: placeholderRef.current,
        geometry: activeGeometry,
        boundary: surfaceRect(surfaceRef.current),
        deltaX: event.delta.x,
        deltaY: event.delta.y,
        previousDeltaX: lastDeltaX.current,
        originId: activeId,
        registry,
      })
      lastDeltaX.current = event.delta.x
      if (nextPlaceholder !== placeholderRef.current) {
        placeholderRef.current = nextPlaceholder
        setPlaceholder(nextPlaceholder)
      }
    }
    const nextOverId = event.over ? String(event.over.id) : null
    setOverId(nextOverId)
    if (!nextOverId || !activeId || nextOverId === activeId) return
    if (nextOverId.startsWith('layout-zone:')) {
      setLiveMessage(`Cel: ${nextOverId.slice('layout-zone:'.length)}`)
      return
    }
    const target = registry.get(nextOverId)
    if (target) setLiveMessage(`Cel: ${elementLabel(target)}`)
  }, [activeGeometry, activeId, dragMode, registry])

  const handleDragMove = React.useCallback((event: DragMoveEvent) => {
    if (dragMode !== 'container' || !activeId || String(event.active.id) !== activeId || !activeElement || !activeGeometry) return
    const nextPlaceholder = resolveLayoutPlaceholderState({
      current: placeholderRef.current,
      geometry: activeGeometry,
      boundary: surfaceRect(surfaceRef.current),
      deltaX: event.delta.x,
      deltaY: event.delta.y,
      previousDeltaX: lastDeltaX.current,
      originId: activeId,
      registry,
    })
    lastDeltaX.current = event.delta.x
    if (nextPlaceholder === placeholderRef.current) return
    placeholderRef.current = nextPlaceholder
    setPlaceholder(nextPlaceholder)
  }, [activeElement, activeGeometry, activeId, dragMode, registry])

  const finishDrag = React.useCallback((event: DragEndEvent) => {
    const sourceId = String(event.active.id)
    const targetId = event.over ? String(event.over.id) : overId
    const source = registry.get(sourceId)
    let moved = false

    const activePlaceholder = placeholderRef.current
    if (dragMode === 'container' && activePlaceholder?.visible && activePlaceholder.placement) {
      const siblings = registry.getSiblingIds(source?.parentId)
      const destinationId = activePlaceholder.placement === 'before' ? siblings.find((id) => id !== sourceId) : [...siblings].reverse().find((id) => id !== sourceId)
      if (destinationId) {
        moved = registry.moveToParent({
          id: sourceId,
          targetId: destinationId,
          position: activePlaceholder.placement,
        })
      }
    } else if (targetId) {
      if (targetId.startsWith('layout-zone:')) {
        if (source?.kind !== 'group') {
          setActiveId(null)
          setOverId(null)
          setActiveGeometry(null)
          placeholderRef.current = null
          setPlaceholder(null)
          setLiveMessage('Przeciąganie anulowane')
          return
        }
        const parentId = targetId.slice('layout-zone:'.length)
        moved = registry.moveToParent({
          id: sourceId,
          targetId: null,
          position: 'after',
          parentId: parentId === 'root' ? null : parentId,
        })
      } else {
        const move = resolveLayoutMove(registry, sourceId, targetId)
        if (move) moved = registry.moveToParent(move)
      }
    }

    if (moved) onLayoutChange?.(registry.getSnapshot())

    setActiveId(null)
    setOverId(null)
    setActiveGeometry(null)
    placeholderRef.current = null
    setPlaceholder(null)
    setLiveMessage(moved && source ? `Przeniesiono: ${elementLabel(source)}` : 'Przeciąganie anulowane')
  }, [dragMode, onLayoutChange, overId, registry])

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null)
    setOverId(null)
    setActiveGeometry(null)
    placeholderRef.current = null
    setPlaceholder(null)
    setLiveMessage('Przeciąganie anulowane')
  }, [])

  const overlay = activeElement
    ? renderOverlay?.(activeElement) ?? <LayoutDragOverlayPreview element={activeElement} scale={resolveLayoutOverlayScale(placeholder)} />
    : null

  const dropIndicatorStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!activeElement || !overId || activeElement.id === overId || overId.startsWith('layout-zone:')) return undefined
    const target = registry.get(overId)
    const rect = target?.domNode?.getBoundingClientRect()
    const bounds = rect && (rect.width !== 0 || rect.height !== 0)
      ? rect
      : activeGeometry
        ? {
            top: activeGeometry.top,
            left: activeGeometry.left,
            right: activeGeometry.left + activeGeometry.width,
            bottom: activeGeometry.top + activeGeometry.height,
            width: activeGeometry.width,
            height: activeGeometry.height,
          }
        : undefined
    if (!bounds) return undefined

    const siblings = registry.getSiblingIds(activeElement.parentId)
    const sourceIndex = siblings.indexOf(activeElement.id)
    const targetIndex = siblings.indexOf(overId)
    const position = activeElement.parentId === target?.parentId && sourceIndex < targetIndex ? 'after' : 'before'

    if (dragMode === 'container') {
      return {
        position: 'fixed',
        top: bounds.top,
        left: position === 'after' ? bounds.right - 1 : bounds.left - 1,
        width: 3,
        height: bounds.height,
        margin: 0,
        minHeight: 0,
      }
    }

    return {
      position: 'fixed',
      top: position === 'after' ? bounds.bottom - 1 : bounds.top - 1,
      left: bounds.left,
      width: bounds.width,
      height: 3,
      margin: 0,
      minHeight: 0,
    }
  }, [activeElement, activeGeometry, dragMode, overId, registry])

  if (!isEnabled) {
    return (
      <LayoutSortableContext.Provider value={{ enabled: false, activeId: null, dragMode, placeholder: null }}>
        <div ref={surfaceRef} className={className} data-slot="layout-sortable-surface" data-edit-mode="false">
          {children}
        </div>
      </LayoutSortableContext.Provider>
    )
  }

  return (
    <LayoutSortableContext.Provider value={{ enabled: isEnabled, activeId, dragMode, placeholder }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={isEnabled ? handleDragStart : undefined}
        onDragMove={isEnabled ? handleDragMove : undefined}
        onDragOver={isEnabled ? handleDragOver : undefined}
        onDragEnd={isEnabled ? finishDrag : undefined}
        onDragCancel={isEnabled ? handleDragCancel : undefined}
      >
        {dragMode === 'sortable' ? (
          <SortableContext items={sortableSnapshot.map((element) => element.id)} strategy={rectSortingStrategy}>
            <div
              ref={surfaceRef}
              className={className}
              data-slot="layout-sortable-surface"
              data-edit-mode={isEnabled ? 'true' : 'false'}
              data-layout-active-id={activeId ?? undefined}
              data-layout-over-id={overId ?? undefined}
            >
              {children}
              {activeId && overId && activeId !== overId ? (
                <div
                  aria-hidden="true"
                  data-slot="layout-drop-indicator"
                  data-layout-drop-target={overId}
                  style={dropIndicatorStyle}
                />
              ) : null}
            </div>
          </SortableContext>
        ) : (
          <div
            ref={surfaceRef}
            className={className}
            data-slot="layout-sortable-surface"
            data-edit-mode={isEnabled ? 'true' : 'false'}
            data-layout-active-id={activeId ?? undefined}
            data-layout-over-id={overId ?? undefined}
          >
            {children}
            {activeId && overId && activeId !== overId ? (
              <div
                aria-hidden="true"
                data-slot="layout-drop-indicator"
                data-layout-drop-target={overId}
                style={dropIndicatorStyle}
              />
            ) : null}
          </div>
        )}
        <DragOverlay
          dropAnimation={null}
          style={activeGeometry ? { width: activeGeometry.width, height: activeGeometry.height } : undefined}
        >
          {isEnabled ? overlay : null}
        </DragOverlay>
      </DndContext>
      <div aria-live="polite" className="sr-only" data-slot="layout-sortable-live-region">
        {liveMessage}
      </div>
    </LayoutSortableContext.Provider>
  )
}
