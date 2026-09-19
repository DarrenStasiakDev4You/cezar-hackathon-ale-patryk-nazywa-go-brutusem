import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useLayoutRegistry } from '@/components/layout-registry'
import { useLayoutSortableContext, type LayoutDragMode } from '@/components/layout-sortable-surface'
import type { LayoutElementKind } from '@/lib/layout-elements'

export type LayoutElementProps = React.HTMLAttributes<HTMLElement> & {
  id: string
  kind: LayoutElementKind
  parentId?: string
  as?: 'article' | 'div' | 'section'
  /** Use a stable draggable/droppable node for full shell containers instead of sortable transforms. */
  dragMode?: LayoutDragMode
}

/** Declares a dashboard widget/group and projects the declaration onto its DOM representative. */
export function LayoutElement({ id, kind, parentId, as = 'div', dragMode: requestedDragMode, children, ...props }: LayoutElementProps) {
  const registry = useLayoutRegistry()
  const { enabled, activeId, dragMode: surfaceDragMode, placeholder } = useLayoutSortableContext()
  const dragMode = requestedDragMode ?? surfaceDragMode
  const sortable = useSortable({ id, disabled: !enabled || dragMode !== 'sortable' })
  const draggable = useDraggable({ id, disabled: !enabled || dragMode !== 'container' })
  const droppable = useDroppable({ id, disabled: !enabled || dragMode !== 'container' })
  const removed = registry.isRemoved(id)
  const order = registry.get(id)?.order ?? -1
  const nodeRef = React.useRef<HTMLElement | null>(null)

  const setNodeRef = React.useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
    sortable.setNodeRef(node)
    draggable.setNodeRef(node)
    droppable.setNodeRef(node)
  }, [draggable.setNodeRef, droppable.setNodeRef, sortable.setNodeRef])

  const interaction = dragMode === 'container' ? draggable : sortable
  const isDragging = dragMode === 'container' ? draggable.isDragging : sortable.isDragging
  const activePlaceholder = dragMode === 'container' && activeId === id && draggable.isDragging
    ? placeholder ?? { visible: true, placement: null, order: null }
    : null

  React.useEffect(() => {
    const unregister = registry.registerDeferred({ id, kind, ...(parentId === undefined ? {} : { parentId }) })
    const detach = nodeRef.current ? registry.attachDomNode(id, nodeRef.current) : undefined
    return () => {
      detach?.()
      unregister()
    }
  }, [id, kind, parentId, registry])

  if (removed) return null

  return React.createElement(
    as,
    {
      ...props,
      ref: setNodeRef,
      style: {
        ...props.style,
        ...(activePlaceholder?.visible && activePlaceholder.order !== null
          ? { order: activePlaceholder.order }
          : order >= 0
            ? { order }
            : {}),
        ...(dragMode === 'sortable' && sortable.transform ? { transform: CSS.Transform.toString(sortable.transform) } : {}),
        transition: dragMode === 'sortable' ? sortable.transition : undefined,
        ...(activePlaceholder?.visible ? { visibility: 'visible' } : {}),
        ...(activePlaceholder && !activePlaceholder.visible ? { display: 'none' } : {}),
      },
      'data-layout-element': 'true',
      'data-layout-id': id,
      'data-layout-kind': kind,
      'data-layout-sortable': enabled && dragMode === 'sortable' ? 'true' : 'false',
      'data-layout-drag-mode': dragMode,
      'data-layout-dragging': isDragging ? 'true' : 'false',
      'data-layout-placeholder': activePlaceholder?.visible ? 'true' : undefined,
      ...(parentId === undefined ? {} : { 'data-layout-parent-id': parentId }),
    },
    enabled ? (
      <button
        type="button"
        className="layout-drag-handle"
        ref={interaction.setActivatorNodeRef}
        {...interaction.attributes}
        {...interaction.listeners}
        aria-label={`Przenieś ${kind === 'group' ? 'grupę' : 'element'} ${id}`}
        data-layout-drag-handle="true"
        data-edit-mode-action="allow"
      >
        ⋮⋮
      </button>
    ) : null,
    children,
  )
}
