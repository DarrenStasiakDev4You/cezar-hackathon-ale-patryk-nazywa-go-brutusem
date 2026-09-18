import { describe, expect, it } from 'vitest'

import { shouldBlockEditModeActivation } from './edit-mode-interaction-guard'

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
})
