import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useLayoutRegistry } from '@/components/layout-registry'
import { useLayoutSortableContext } from '@/components/layout-sortable-surface'
import type { LayoutElementKind } from '@/lib/layout-elements'

export type LayoutElementProps = React.HTMLAttributes<HTMLElement> & {
  id: string
  kind: LayoutElementKind
  parentId?: string
  as?: 'article' | 'div' | 'section'
}

/** Declares a dashboard widget/group and projects the declaration onto its DOM representative. */
export function LayoutElement({ id, kind, parentId, as = 'div', children, ...props }: LayoutElementProps) {
  const registry = useLayoutRegistry()
  const { enabled } = useLayoutSortableContext()
  const sortable = useSortable({ id, disabled: !enabled })
  const removed = registry.isRemoved(id)
  const order = registry.get(id)?.order ?? -1
  const nodeRef = React.useRef<HTMLElement | null>(null)

  const setNodeRef = React.useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
    sortable.setNodeRef(node)
  }, [sortable.setNodeRef])

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
        ...(order >= 0 ? { order } : {}),
        ...(sortable.transform ? { transform: CSS.Transform.toString(sortable.transform) } : {}),
        transition: sortable.transition,
      },
      'data-layout-element': 'true',
      'data-layout-id': id,
      'data-layout-kind': kind,
      'data-layout-sortable': enabled ? 'true' : 'false',
      'data-layout-dragging': sortable.isDragging ? 'true' : 'false',
      ...(parentId === undefined ? {} : { 'data-layout-parent-id': parentId }),
    },
    enabled ? (
      <button
        type="button"
        className="layout-drag-handle"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
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
