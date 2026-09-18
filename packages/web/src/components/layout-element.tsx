import * as React from 'react'

import { useLayoutRegistry } from '@/components/layout-registry'
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
  const nodeRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const unregister = registry.registerDeferred({ id, kind, ...(parentId === undefined ? {} : { parentId }) })
    const detach = nodeRef.current ? registry.attachDomNode(id, nodeRef.current) : undefined
    return () => {
      detach?.()
      unregister()
    }
  }, [id, kind, parentId, registry])

  return React.createElement(
    as,
    {
      ...props,
      ref: nodeRef,
      'data-layout-element': 'true',
      'data-layout-id': id,
      'data-layout-kind': kind,
      ...(parentId === undefined ? {} : { 'data-layout-parent-id': parentId }),
    },
    children,
  )
}
