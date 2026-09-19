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
}

export type LayoutDragMode = 'sortable' | 'container'

const LayoutSortableContext = React.createContext<LayoutSortableContextValue>({
  enabled: false,
  activeId: null,
  dragMode: 'sortable',
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
  const [liveMessage, setLiveMessage] = React.useState('')
  const activeElement = activeId ? registry.get(activeId) : undefined

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id = String(event.active.id)
    const element = registry.get(id)
    const rect = event.active.rect.current.initial
    setActiveId(id)
    setOverId(null)
    setActiveGeometry(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null)
    setLiveMessage(element ? `Podniesiono: ${elementLabel(element)}` : '')
  }, [registry])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const nextOverId = event.over ? String(event.over.id) : null
    setOverId(nextOverId)
    if (!nextOverId || !activeId || nextOverId === activeId) return
    if (nextOverId.startsWith('layout-zone:')) {
      setLiveMessage(`Cel: ${nextOverId.slice('layout-zone:'.length)}`)
      return
    }
    const target = registry.get(nextOverId)
    if (target) setLiveMessage(`Cel: ${elementLabel(target)}`)
  }, [activeId, registry])

  const finishDrag = React.useCallback((event: DragEndEvent) => {
    const sourceId = String(event.active.id)
    const targetId = event.over ? String(event.over.id) : overId
    const source = registry.get(sourceId)
    let moved = false

    if (targetId) {
      if (targetId.startsWith('layout-zone:')) {
        if (source?.kind !== 'group') {
          setActiveId(null)
          setOverId(null)
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
    setLiveMessage(moved && source ? `Przeniesiono: ${elementLabel(source)}` : 'Przeciąganie anulowane')
  }, [onLayoutChange, overId, registry])

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null)
    setOverId(null)
    setActiveGeometry(null)
    setLiveMessage('Przeciąganie anulowane')
  }, [])

  const overlay = activeElement
    ? renderOverlay?.(activeElement) ?? <div className="layout-drag-overlay-label">{elementLabel(activeElement)}</div>
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
      <LayoutSortableContext.Provider value={{ enabled: false, activeId: null, dragMode }}>
        <div className={className} data-slot="layout-sortable-surface" data-edit-mode="false">
          {children}
        </div>
      </LayoutSortableContext.Provider>
    )
  }

  return (
    <LayoutSortableContext.Provider value={{ enabled: isEnabled, activeId, dragMode }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={isEnabled ? handleDragStart : undefined}
        onDragOver={isEnabled ? handleDragOver : undefined}
        onDragEnd={isEnabled ? finishDrag : undefined}
        onDragCancel={isEnabled ? handleDragCancel : undefined}
      >
        {dragMode === 'sortable' ? (
          <SortableContext items={sortableSnapshot.map((element) => element.id)} strategy={rectSortingStrategy}>
            <div
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
