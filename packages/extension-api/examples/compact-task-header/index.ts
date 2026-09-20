import { createElement as h } from 'react'

import {
  defineExtension,
  TaskHeader,
  type ComponentProps,
  type TaskHeaderActionState,
} from '@open-mercato/cezar-extension-api'

// A replacement for core's task header part, written against this package and `react` alone —
// the brief's proof that a header can live in a separate package (spec
// `2026-09-19-task-header-contract`, Q9). It is a `.ts` file using `createElement`, so the boundary
// test reads it and the package needs no JSX setting. It takes over Continue, Stop and Archive
// (`offers-*`): core then leaves them out of its action bar and keeps its Run actions menu visible.

type Props = ComponentProps<typeof TaskHeader>

/** One of the task's actions: shown while it is offered, disabled while it cannot run. */
function action(label: string, state: TaskHeaderActionState, onPress: () => void) {
  if (!state.available) return null
  return h(
    'button',
    {
      type: 'button',
      'data-action': label.toLowerCase(),
      disabled: !state.enabled,
      title: state.reason,
      onClick: onPress,
      style: { font: 'inherit', fontSize: 12, padding: '2px 8px' },
    },
    label,
  )
}

/** One row: title · status · runner/model · the task's main actions. */
function CompactTaskHeader(props: Props) {
  const { task, attention, engine, actions } = props
  return h(
    'div',
    {
      'data-example': 'compact-task-header',
      style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, fontSize: 13, minWidth: 0 },
    },
    h(
      'strong',
      { title: task.prompt, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
      task.title,
    ),
    h('span', { 'data-part': 'status' }, attention.queuePosition === undefined ? attention.label : `${attention.label} #${attention.queuePosition}`),
    h('span', { 'data-part': 'engine', style: { fontFamily: 'monospace', fontSize: 11 } }, `${engine.runner} · ${engine.model}`),
    h(
      'span',
      { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
      action('Continue', actions.continue, props.onContinue),
      // Core asks the user to confirm before it stops anything.
      action('Stop', actions.stop, props.onStop),
      action(task.archived ? 'Unarchive' : 'Archive', actions.archive, props.onArchive),
    ),
  )
}

export default defineExtension({
  // `>=0.11.2`: the first release after 0.11.1 can ship `task.header@1`.
  manifest: { id: 'example.compact-header', name: 'Compact task header', version: '1.0.0', engines: { cezar: '>=0.11.2' } },
  activate(context) {
    context.components.provide(TaskHeader, {
      id: 'example.compact-header.row',
      title: 'Compact row',
      capabilities: ['shows-title', 'shows-status', 'offers-continue', 'offers-stop', 'offers-archive'],
      component: CompactTaskHeader,
    })
  },
})
