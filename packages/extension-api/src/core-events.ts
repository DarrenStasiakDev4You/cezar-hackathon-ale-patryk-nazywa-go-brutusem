import { defineEvent } from './events.ts'

/**
 * Core's public events — the `cezar.*` tokens the cockpit emits and any extension may listen to
 * through `context.events`. Only core emits them: an extension's `emit` of a `cezar.*` id throws
 * `namespace-violation`, whatever the extension's own id.
 *
 * The payloads are narrow view models declared here — ids, statuses and versions, never a prompt, a
 * title or a path — because this package never imports the contract (`test/boundary.test.ts`). A core token
 * lands here in the same PR as the host code that emits it.
 */

/**
 * A task, as core events name it. Assignable to `TaskRef`, so it can be passed straight to the
 * task commands: `events.on(TaskCompleted, (task) => commands.execute(TaskArchive, task))`.
 */
export interface TaskEvent {
  readonly taskId: string
  /** The registered project that owns the task — always present, unlike `TaskRef.projectId`. */
  readonly projectId: string
  /** The status now: `queued`, `running`, `waiting`, `review`, `done`, `failed` or `cancelled` today (the union may grow). */
  readonly status: string
}

/** A task whose status changed. */
export interface TaskTransition extends TaskEvent {
  /** The status the server held before this change. */
  readonly previousStatus: string
}

/** The project the cockpit shows changed. */
export interface ProjectChange {
  /** The project the cockpit now shows; `null` on a page that belongs to no project. */
  readonly projectId: string | null
  readonly previousProjectId: string | null
}

/** An extension that has just become active. */
export interface ExtensionActivation {
  readonly extensionId: string
  /** The manifest's `version`. */
  readonly version: string
}

/**
 * An extension became `active`. Emitted after its own listeners are live, so an extension that
 * subscribes in `activate` also hears its own activation. Not replayed: an extension activated
 * later does not hear the earlier ones.
 */
export const ExtensionActivated = defineEvent<ExtensionActivation>('cezar.extension.activated')

/**
 * Every status change of any task in any registered project — the canonical event the semantic
 * ones below refine. It fires first; a semantic event for the same change follows it.
 */
export const TaskStatusChanged = defineEvent<TaskTransition>('cezar.task.status-changed')
/**
 * Into `running` from anything but `running` and `waiting`: a start, a Continue, a send-back or an
 * auto-resume — not an answered question. A deferred resume (an auto-resume, or one that waits for
 * capacity) re-queues first, so its `previousStatus` is `queued`, not the finished status.
 */
export const TaskStarted = defineEvent<TaskTransition>('cezar.task.started')
/** Into `done` or `review` from outside that pair: a successful finish. Accepting a review (`review → done`) is not a second one. */
export const TaskCompleted = defineEvent<TaskTransition>('cezar.task.completed')
/** Into `failed` — a usage-limit parking included. */
export const TaskFailed = defineEvent<TaskTransition>('cezar.task.failed')
/** Into `cancelled`. */
export const TaskCancelled = defineEvent<TaskTransition>('cezar.task.cancelled')
/** Archived (`false → true`), from anywhere; emitted last for its change. Restoring emits nothing. */
export const TaskArchived = defineEvent<TaskEvent>('cezar.task.archived')
/**
 * The registered project the cockpit shows changed — `null` on a page that belongs to no project
 * (global Tasks, global settings, an unknown project). Starts from `null`; not replayed, and there
 * is no getter, so an extension activated later hears the next change only.
 */
export const ProjectChanged = defineEvent<ProjectChange>('cezar.project.changed')
