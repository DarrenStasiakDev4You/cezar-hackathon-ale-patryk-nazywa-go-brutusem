import { describe, expect, it } from 'vitest'

import {
  isEditModeActive,
  shouldBlockEditModeActivation,
  shouldBlockEditModeKeyActivation,
  type EditModeKeyActivation,
} from './edit-mode-interaction-guard'

describe('shouldBlockEditModeActivation', () => {
  it('blocks nested targets inside links and buttons', () => {
    const button = document.createElement('button')
    const icon = document.createElement('span')
    button.append(icon)

    expect(shouldBlockEditModeActivation(icon, 'click')).toBe(true)
  })

  it('blocks native and router links, including external links', () => {
    const container = document.createElement('div')
    container.innerHTML = '<a href="/tasks">Tasks</a><a href="https://example.test">External</a>'

    for (const link of container.querySelectorAll('a')) {
      expect(shouldBlockEditModeActivation(link, 'click')).toBe(true)
    }
  })

  it('allows an explicitly marked editor action', () => {
    const button = document.createElement('button')
    button.dataset.editModeAction = 'allow'

    expect(shouldBlockEditModeActivation(button, 'click')).toBe(false)
  })

  it('does not let an editor marker on a wrapper allow a nested business control', () => {
    const wrapper = document.createElement('div')
    wrapper.dataset.editModeAction = 'allow'
    const button = document.createElement('button')
    wrapper.append(button)

    expect(shouldBlockEditModeActivation(button, 'click')).toBe(true)
  })

  it('allows an inspectable dropdown trigger but not its menu items', () => {
    const trigger = document.createElement('button')
    trigger.dataset.editModeOpen = 'allow'
    const menuItem = document.createElement('div')
    menuItem.setAttribute('role', 'menuitem')

    expect(shouldBlockEditModeActivation(trigger, 'click')).toBe(false)
    expect(shouldBlockEditModeActivation(menuItem, 'click')).toBe(true)
  })

  it('blocks business forms and implicit submits', () => {
    const form = document.createElement('form')
    const input = document.createElement('input')
    form.append(input)

    expect(shouldBlockEditModeActivation(form, 'submit')).toBe(true)
    expect(shouldBlockEditModeActivation(input, 'submit')).toBe(true)
  })

  it('allows a form only when the form or its submitter belongs to the editor', () => {
    const form = document.createElement('form')
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.dataset.editModeAction = 'allow'
    form.append(submit)

    expect(shouldBlockEditModeActivation(form, 'submit', submit)).toBe(false)

    form.dataset.editModeAction = 'allow'
    expect(shouldBlockEditModeActivation(form, 'submit')).toBe(false)
  })

  it('leaves non-activating content alone', () => {
    const text = document.createElement('p')
    expect(shouldBlockEditModeActivation(text, 'click')).toBe(false)
  })

  it('blocks ARIA widget items that act on click, such as options and checkbox menu items', () => {
    for (const role of ['option', 'menuitemcheckbox', 'menuitemradio', 'tab', 'link']) {
      const item = document.createElement('div')
      item.setAttribute('role', role)
      expect(shouldBlockEditModeActivation(item, 'click')).toBe(true)
    }
  })
})

describe('shouldBlockEditModeKeyActivation', () => {
  function key(overrides: Partial<EditModeKeyActivation>): EditModeKeyActivation {
    return { key: 'Enter', shiftKey: false, target: document.createElement('button'), ...overrides }
  }

  it('blocks Enter on business controls, text fields and non-interactive targets', () => {
    const textarea = document.createElement('textarea')
    const option = document.createElement('div')
    option.setAttribute('role', 'option')

    expect(shouldBlockEditModeKeyActivation(key({}))).toBe(true)
    expect(shouldBlockEditModeKeyActivation(key({ target: textarea }))).toBe(true)
    expect(shouldBlockEditModeKeyActivation(key({ target: option }))).toBe(true)
    expect(shouldBlockEditModeKeyActivation(key({ target: document.body }))).toBe(true)
  })

  it('keeps the newline, IME composition and editor actions available', () => {
    const textarea = document.createElement('textarea')
    const exit = document.createElement('button')
    exit.dataset.editModeAction = 'allow'

    expect(shouldBlockEditModeKeyActivation(key({ target: textarea, shiftKey: true }))).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ target: textarea, isComposing: true }))).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ target: exit }))).toBe(false)
  })

  it('keeps a sortable editor handle available for keyboard pickup', () => {
    const handle = document.createElement('button')
    handle.dataset.editModeAction = 'allow'
    handle.dataset.layoutDragHandle = 'true'

    expect(shouldBlockEditModeActivation(handle, 'click')).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ key: ' ', target: handle }))).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ target: handle }))).toBe(false)
  })

  it('blocks Space only where it activates rather than types', () => {
    const input = document.createElement('input')
    const text = document.createElement('p')
    const exit = document.createElement('button')
    exit.dataset.editModeAction = 'allow'

    expect(shouldBlockEditModeKeyActivation(key({ key: ' ' }))).toBe(true)
    expect(shouldBlockEditModeKeyActivation(key({ key: ' ', target: input }))).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ key: ' ', target: text }))).toBe(false)
    expect(shouldBlockEditModeKeyActivation(key({ key: ' ', target: exit }))).toBe(false)
  })

  it('never touches navigation and text-entry keys', () => {
    for (const name of ['Tab', 'Escape', 'ArrowDown', 'a']) {
      expect(shouldBlockEditModeKeyActivation(key({ key: name }))).toBe(false)
    }
  })
})

describe('isEditModeActive', () => {
  it('reads the shell marker, not any element that happens to carry data-edit-mode', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-slot="edit-mode-surface" data-edit-mode="true"></div>'
    expect(isEditModeActive(root)).toBe(false)

    root.innerHTML = '<div data-slot="app-shell" data-edit-mode="false"></div>'
    expect(isEditModeActive(root)).toBe(false)

    root.innerHTML = '<div data-slot="app-shell" data-edit-mode="true"></div>'
    expect(isEditModeActive(root)).toBe(true)
  })
})
