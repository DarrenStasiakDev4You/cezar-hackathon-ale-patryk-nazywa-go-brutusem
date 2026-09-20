import { createElement as h, useCallback } from 'react'

import { defineExtension, TaskComposer, type ComponentProps } from '@open-mercato/cezar-extension-api'

/** A deliberately small external implementation: core still owns the draft and delivery. */
function PlainTaskComposer(props: ComponentProps<typeof TaskComposer>) {
  const onChange = useCallback(
    (event: { readonly currentTarget: { readonly value: string } }) => props.onTextChange(event.currentTarget.value),
    [props.onTextChange],
  )
  const onSubmit = useCallback(
    (event: { preventDefault(): void }) => {
      event.preventDefault()
      props.onSubmit()
    },
    [props.onSubmit],
  )
  return h(
    'form',
    { onSubmit, 'data-slot': 'plain-task-composer' },
    h('textarea', {
      value: props.draft.text,
      onChange,
      disabled: !props.availability.enabled || !props.actions.submit.enabled,
      placeholder: props.availability.reason ?? props.status.placeholder,
      'aria-label': 'Reply to the agent',
    }),
    h(
      'button',
      { type: 'submit', disabled: !props.actions.submit.available || !props.actions.submit.enabled },
      props.status.submitLabel,
    ),
  )
}

export default defineExtension({
  manifest: {
    id: 'example.plain-composer',
    name: 'Plain task composer',
    version: '1.0.0',
    engines: { cezar: '>=0.11.1' },
    permissions: ['ui.components'],
  },
  activate(context) {
    context.components.provide(TaskComposer, {
      id: 'example.plain-composer.box',
      title: 'Plain box',
      capabilities: ['edits-draft', 'sends', 'shows-availability'],
      component: PlainTaskComposer,
    })
  },
})
