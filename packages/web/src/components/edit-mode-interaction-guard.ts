const interactiveSelector = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const editorActionSelector =
  '[data-edit-mode-action="allow"], [data-edit-mode-open="allow"]'

const textEntrySelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

function closestInteractive(target: EventTarget | null): Element | null {
  const element = elementFromTarget(target)
  return element?.closest(interactiveSelector) ?? null
}

function hasEditorPermission(element: Element | null): boolean {
  return element?.matches(editorActionSelector) ?? false
}

export type EditModeActivation = 'click' | 'submit'

/**
 * Returns whether an activation must be stopped while the shell is in edit mode.
 *
 * This is intentionally DOM-only. Widgets do not consume editMode; the shell owns the policy and
 * opt-in editor actions with data attributes. A dropdown trigger may opt into opening itself, but
 * its menu items are separate interactive elements and remain blocked by default.
 */
export function shouldBlockEditModeActivation(
  target: EventTarget | null,
  activation: EditModeActivation,
  submitter: EventTarget | null = null,
): boolean {
  if (activation === 'submit') {
    const form = elementFromTarget(target)?.closest('form')
    if (!form) return false
    const submitControl = closestInteractive(submitter)
    return !(hasEditorPermission(submitControl) || hasEditorPermission(form))
  }

  const interactive = closestInteractive(target)
  if (!interactive) return false
  return !hasEditorPermission(interactive)
}

/**
 * Whether the shell is in edit mode, read from the shell's DOM marker rather than React state so
 * the rule also reaches global keyboard accelerators whose listeners live outside the AppShell
 * tree (⌘K palette, `c` to create, composer quick replies).
 */
export function isEditModeActive(root: ParentNode = document): boolean {
  return root.querySelector('[data-slot="app-shell"][data-edit-mode="true"]') !== null
}

export type EditModeKeyActivation = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'> & {
  isComposing?: boolean
}

/**
 * Returns whether a keydown inside the shell must be stopped while in edit mode.
 *
 * Several widgets act on the key itself instead of emitting a cancellable click — cmdk and menu
 * items select on Enter, the composer sends on Enter / ⌘↵ — so the click guard alone never sees
 * them. Enter is an activation almost everywhere and is blocked unless the closest interactive
 * element is an editor action; Shift+Enter (the newline) and Enter that commits an IME
 * composition stay available. Space is blocked only on non-text controls, where it activates
 * rather than types. Tab, arrows, Escape and text entry are never touched.
 */
export function shouldBlockEditModeKeyActivation(event: EditModeKeyActivation): boolean {
  if (event.key === 'Enter') {
    if (event.shiftKey || event.isComposing) return false
    return !hasEditorPermission(closestInteractive(event.target))
  }

  if (event.key === ' ') {
    if (elementFromTarget(event.target)?.closest(textEntrySelector)) return false
    const interactive = closestInteractive(event.target)
    if (!interactive) return false
    return !hasEditorPermission(interactive)
  }

  return false
}
