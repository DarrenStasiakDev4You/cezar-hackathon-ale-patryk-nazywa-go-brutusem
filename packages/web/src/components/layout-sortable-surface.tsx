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
}

const LayoutSortableContext = React.createContext<LayoutSortableContextValue>({ enabled: false, activeId: null })

export function useLayoutSortableContext(): LayoutSortableContextValue {
  return React.useContext(LayoutSortableContext)
}

export type LayoutSortableSurfaceProps = {
  children: React.ReactNode
  enabled?: boolean
  className?: string
  /** Limit this surface to one layout container; useful when a page and the shell share a registry. */
  ids?: string[]
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

export function LayoutSortableSurface({ children, enabled, className, ids, renderOverlay, onLayoutChange }: LayoutSortableSurfaceProps) {
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
  const [liveMessage, setLiveMessage] = React.useState('')
  const activeElement = activeId ? registry.get(activeId) : undefined

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id = String(event.active.id)
    const element = registry.get(id)
    setActiveId(id)
    setOverId(null)
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
    setLiveMessage(moved && source ? `Przeniesiono: ${elementLabel(source)}` : 'Przeciąganie anulowane')
  }, [onLayoutChange, overId, registry])

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null)
    setOverId(null)
    setLiveMessage('Przeciąganie anulowane')
  }, [])

  const overlay = activeElement
    ? renderOverlay?.(activeElement) ?? <div className="layout-drag-overlay-label">{elementLabel(activeElement)}</div>
    : null

  if (!isEnabled) {
    return (
      <LayoutSortableContext.Provider value={{ enabled: false, activeId: null }}>
        <div className={className} data-slot="layout-sortable-surface" data-edit-mode="false">
          {children}
        </div>
      </LayoutSortableContext.Provider>
    )
  }

  return (
    <LayoutSortableContext.Provider value={{ enabled: isEnabled, activeId }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={isEnabled ? handleDragStart : undefined}
        onDragOver={isEnabled ? handleDragOver : undefined}
        onDragEnd={isEnabled ? finishDrag : undefined}
        onDragCancel={isEnabled ? handleDragCancel : undefined}
      >
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
              <div aria-hidden="true" data-slot="layout-drop-indicator" data-layout-drop-target={overId} />
            ) : null}
          </div>
        </SortableContext>
        <DragOverlay>{isEnabled ? overlay : null}</DragOverlay>
      </DndContext>
      <div aria-live="polite" className="sr-only" data-slot="layout-sortable-live-region">
        {liveMessage}
      </div>
    </LayoutSortableContext.Provider>
  )
}
