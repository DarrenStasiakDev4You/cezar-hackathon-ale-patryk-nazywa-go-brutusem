const interactiveSelector = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const editorActionSelector =
  '[data-edit-mode-action="allow"], [data-edit-mode-open="allow"]'

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
