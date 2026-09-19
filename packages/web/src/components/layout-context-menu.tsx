import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoveIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { useLayoutRegistry } from '@/components/layout-registry'
import type { LayoutElementKind } from '@/lib/layout-elements'

export type LayoutContextMenuTarget = {
  id: string
  kind: LayoutElementKind
  subtreeIds: string[]
}

export type LayoutElementContextMenuProps = {
  enabled: boolean
  onDelete: (target: LayoutContextMenuTarget) => void
  /** Reserved for the future confirmation phase. Returning false cancels deletion. */
  confirmDelete?: (target: LayoutContextMenuTarget) => boolean | Promise<boolean>
  children: React.ReactNode
}

type MenuPosition = { x: number; y: number }

const MENU_WIDTH = 176
const MENU_HEIGHT = 112
const VIEWPORT_PADDING = 8

const targetFromElement = (
  element: Element,
  registry: ReturnType<typeof useLayoutRegistry>,
): LayoutContextMenuTarget | null => {
  const id = element.getAttribute('data-layout-id')
  if (!id || element.getAttribute('data-layout-element') !== 'true') return null

  const registered = registry.get(id)
  if (!registered || !registered.domNode || !registered.domNode.contains(element)) return null

  return {
    id: registered.id,
    kind: registered.kind,
    subtreeIds: registry.getSubtree(registered.id).map((item) => item.id),
  }
}

const getLayoutTarget = (eventTarget: EventTarget | null, registry: ReturnType<typeof useLayoutRegistry>) => {
  if (!(eventTarget instanceof Element)) return null
  return targetFromElement(eventTarget.closest('[data-layout-element="true"][data-layout-id]') ?? eventTarget, registry)
}

export function LayoutElementContextMenu({ enabled, onDelete, confirmDelete, children }: LayoutElementContextMenuProps) {
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
    if (!target || registry.get(target.id)?.domNode) return
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

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled) return
    const nextTarget = getLayoutTarget(event.target, registry)
    if (!nextTarget) return
    event.preventDefault()
    event.stopPropagation()
    setTarget(nextTarget)
    setPosition({ x: event.clientX, y: event.clientY })
  }

  const handleDelete = async () => {
    if (!target || deletingRef.current) return
    const current = registry.get(target.id)
    if (!current?.domNode) {
      close()
      return
    }
    deletingRef.current = true
    if (confirmDelete && !(await confirmDelete(target))) {
      close()
      return
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
        // An editor action: without the opt-in, the shell's edit-mode guard (spec
        // 2026-09-18-global-edit-mode-interaction-guard) swallows the click and the Enter key, and
        // the menu only ever opens in edit mode.
        data-edit-mode-action="allow"
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

  return (
    <>
      <div data-layout-context-menu-owner="true" className="contents" onContextMenuCapture={onContextMenu}>
        {children}
      </div>
      {content && typeof document !== 'undefined' ? createPortal(content, document.body) : null}
    </>
  )
}
