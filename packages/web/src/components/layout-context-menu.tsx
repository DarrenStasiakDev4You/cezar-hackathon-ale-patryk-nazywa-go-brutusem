import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoveIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { useLayoutRegistry } from '@/components/layout-registry'
import type { LayoutElementKind } from '@/lib/layout-elements'

export type LayoutContextMenuTarget = {
  id: string
  kind: LayoutElementKind
  subtreeIds: string[]
  domNode?: Element
}

export type LayoutElementContextMenuProps = {
  enabled: boolean
  onDelete: (target: LayoutContextMenuTarget) => void
  allowAnyElement?: boolean
  /** Reserved for the future confirmation phase. Returning false cancels deletion. */
  confirmDelete?: (target: LayoutContextMenuTarget) => boolean | Promise<boolean>
  children: React.ReactNode
}

type MenuPosition = { x: number; y: number }

const MENU_WIDTH = 176
const MENU_HEIGHT = 112
const VIEWPORT_PADDING = 8

const genericTargetIds = new WeakMap<Element, string>()
let nextGenericTargetId = 1

const genericTargetId = (element: Element): string => {
  const existing = genericTargetIds.get(element)
  if (existing) return existing
  const id = `dom-${nextGenericTargetId++}`
  genericTargetIds.set(element, id)
  return id
}

const targetFromElement = (
  element: Element,
  registry: ReturnType<typeof useLayoutRegistry>,
  allowAnyElement: boolean,
): LayoutContextMenuTarget | null => {
  // Identity is always taken from the concrete registered element carrying the attribute. Do not
  // walk to a parent as a fallback: nested children must own their own context-menu target.
  const id = element.getAttribute('data-layout-id')
  if (id && element.getAttribute('data-layout-element') === 'true') {
    const registered = registry.get(id)
    if (!registered || !registered.domNode || !registered.domNode.contains(element)) return null
    return { id: registered.id, kind: registered.kind, subtreeIds: registry.getSubtree(registered.id).map((item) => item.id) }
  }
  if (!allowAnyElement || element.closest('[data-layout-context-menu="true"]')) return null
  return { id: genericTargetId(element), kind: 'widget', subtreeIds: [], domNode: element }
}

const getLayoutTarget = (eventTarget: EventTarget | null, registry: ReturnType<typeof useLayoutRegistry>, allowAnyElement: boolean) => {
  if (!(eventTarget instanceof Element)) return null
  const targetElement = eventTarget.closest('[data-layout-element="true"][data-layout-id]')
    ?? eventTarget.closest('a,button,input,select,textarea,[role],section,article,li,td,th,div')
    ?? eventTarget
  return targetFromElement(targetElement, registry, allowAnyElement)
}

export function LayoutElementContextMenu({ enabled, onDelete, confirmDelete, allowAnyElement = false, children }: LayoutElementContextMenuProps) {
  const registry = useLayoutRegistry()
  const registrySnapshot = registry.getExternalSnapshot()
  const [target, setTarget] = React.useState<LayoutContextMenuTarget | null>(null)
  const [position, setPosition] = React.useState<MenuPosition | null>(null)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const menuRef = React.useRef<HTMLDivElement>(null)
  const deletingRef = React.useRef(false)

  const close = React.useCallback(() => {
    setTarget(null)
    setPosition(null)
    setMenuStyle({})
    deletingRef.current = false
  }, [])

  React.useEffect(() => {
    if (!target) return
    if (target.domNode?.isConnected || registry.get(target.id)?.domNode) return
    close()
  }, [close, registry, registrySnapshot, target])

  React.useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const width = menuRef.current.offsetWidth || MENU_WIDTH
    const height = menuRef.current.offsetHeight || MENU_HEIGHT
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING)
    setMenuStyle({ left: Math.min(Math.max(position.x, VIEWPORT_PADDING), maxX), top: Math.min(Math.max(position.y, VIEWPORT_PADDING), maxY) })
  }, [position])

  React.useEffect(() => {
    if (!enabled || !target) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, enabled, target])

  React.useEffect(() => {
    if (!target) return
    menuRef.current?.querySelector<HTMLButtonElement>('[data-layout-menu-delete]')?.focus()
  }, [target])

  React.useEffect(() => {
    if (!enabled) close()
  }, [close, enabled])

  const openFromContextMenu = React.useCallback((event: { target: EventTarget | null; clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }) => {
    if (!enabled) return
    const nextTarget = getLayoutTarget(event.target, registry, allowAnyElement)
    if (!nextTarget) return
    event.preventDefault()
    event.stopPropagation()
    setTarget(nextTarget)
    setPosition({ x: event.clientX, y: event.clientY })
  }, [allowAnyElement, enabled, registry])

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const handleWindowContextMenu = (event: MouseEvent) => openFromContextMenu(event)
    const handleWindowMouseDown = (event: MouseEvent) => {
      if (event.button === 2) openFromContextMenu(event)
    }
    window.addEventListener('contextmenu', handleWindowContextMenu, true)
    window.addEventListener('mousedown', handleWindowMouseDown, true)
    return () => {
      window.removeEventListener('contextmenu', handleWindowContextMenu, true)
      window.removeEventListener('mousedown', handleWindowMouseDown, true)
    }
  }, [enabled, openFromContextMenu])

  const handleDelete = async () => {
    if (!target || deletingRef.current) return
    const current = registry.get(target.id)
    if (!current?.domNode && !target.domNode?.isConnected) {
      close()
      return
    }
    deletingRef.current = true
    if (confirmDelete && !(await confirmDelete(target))) {
      close()
      return
    }
    if (current) {
      registry.removeNode(target.id)
    } else {
      target.domNode?.remove()
    }
    close()
    onDelete(target)
  }

  const content = target && position ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Layout element actions"
      data-layout-context-menu="true"
      className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={menuStyle}
      onKeyDown={(event) => {
        if (event.key === 'Tab') close()
      }}
    >
      <button type="button" role="menuitem" disabled className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-50">
        <PencilIcon aria-hidden="true" className="size-4" />
        <span>Edit</span>
      </button>
      <button type="button" role="menuitem" disabled className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-50">
        <MoveIcon aria-hidden="true" className="size-4" />
        <span>Move</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-layout-menu-delete="true"
        aria-label="Delete layout element"
        aria-describedby="layout-context-menu-delete-description"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-hidden focus:bg-destructive/10"
        onClick={() => void handleDelete()}
      >
        <Trash2Icon aria-hidden="true" className="size-4" />
        <span>Delete</span>
      </button>
      <span id="layout-context-menu-delete-description" className="sr-only">
        Deletes this layout element and all registered descendants.
      </span>
    </div>
  ) : null

  const handleReactContextMenu = (event: React.MouseEvent<HTMLDivElement>) => openFromContextMenu(event)

  return (
    <>
      <div data-layout-context-menu-owner="true" className="contents" onContextMenuCapture={handleReactContextMenu}>
        {children}
      </div>
      {content && typeof document !== 'undefined' ? createPortal(content, document.body) : null}
    </>
  )
}
