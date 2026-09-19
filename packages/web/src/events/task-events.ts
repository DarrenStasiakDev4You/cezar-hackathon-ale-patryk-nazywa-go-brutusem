import {
  TaskArchived,
  TaskCancelled,
  TaskCompleted,
  TaskFailed,
  TaskStarted,
  TaskStatusChanged,
  type EventToken,
  type TaskEvent,
  type TaskTransition,
} from '@open-mercato/cezar-extension-api'
import type { TaskTransitionEvent } from '@open-mercato/cezar-api-client'

import type { EventBus } from './bus'

/**
 * One wire `task-transition` → the core task events it means (spec
 * `.ai/specs/2026-09-19-extension-event-api.md`, Q5). PURE: the server says THAT a task changed
 * state, and this is the one place that names what the change means, so new meanings grow here
 * without a protocol change.
 *
 * | Wire change | Bus events, in order |
 * |---|---|
 * | `status !== previousStatus` | `cezar.task.status-changed`, always first |
 * | into `running` from anything but `running`/`waiting` | then `cezar.task.started` |
 * | into `done` or `review` from outside that pair | then `cezar.task.completed` |
 * | into `failed` | then `cezar.task.failed` |
 * | into `cancelled` | then `cezar.task.cancelled` |
 * | `archived` from `false` to `true` | last, `cezar.task.archived` |
 *
 * So answering an agent's question (`waiting → running`) and accepting a review (`review → done`)
 * are status changes but neither a start nor a second completion; restoring a task emits nothing.
 */
export type TaskBusEvent =
  | { readonly token: EventToken<TaskTransition>; readonly payload: TaskTransition }
  | { readonly token: EventToken<TaskEvent>; readonly payload: TaskEvent }

const SUCCESS: ReadonlySet<string> = new Set(['done', 'review'])
/** A move into `running` from these is not a start: already running, or an answered question. */
const NOT_A_START: ReadonlySet<string> = new Set(['running', 'waiting'])

/** One wire transition → its bus events, in emit order. */
export function taskEventsFor(transition: TaskTransitionEvent): readonly TaskBusEvent[] {
  const { project: projectId, id: taskId, status, previousStatus } = transition
  const events: TaskBusEvent[] = []

  if (status !== previousStatus) {
    const payload: TaskTransition = { taskId, projectId, status, previousStatus }
    events.push({ token: TaskStatusChanged, payload })
    if (status === 'running' && !NOT_A_START.has(previousStatus)) events.push({ token: TaskStarted, payload })
    if (SUCCESS.has(status) && !SUCCESS.has(previousStatus)) events.push({ token: TaskCompleted, payload })
    if (status === 'failed') events.push({ token: TaskFailed, payload })
    if (status === 'cancelled') events.push({ token: TaskCancelled, payload })
  }
  if (transition.archived && !transition.previousArchived) {
    events.push({ token: TaskArchived, payload: { taskId, projectId, status } })
  }
  return events
}

/** Emits a wire transition's events on `bus`, in order. Throws what `bus.emit` throws. */
export function emitTaskEvents(bus: EventBus, transition: TaskTransitionEvent): void {
  for (const event of taskEventsFor(transition)) {
    if (isTaskEventOnly(event)) bus.emit(event.token, event.payload)
    else bus.emit(event.token, event.payload)
  }
}

/** The archive event carries a `TaskEvent`; every other one a `TaskTransition`. */
function isTaskEventOnly(event: TaskBusEvent): event is Extract<TaskBusEvent, { readonly token: EventToken<TaskEvent> }> {
  return event.token.id === TaskArchived.id
}
