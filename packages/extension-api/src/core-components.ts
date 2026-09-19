import { defineComponentContract } from './components.ts'

/**
 * Core's public component contracts — the `cezar.*` tokens the cockpit renders through its
 * component host, and any extension may implement through `context.components.provide`. Providing
 * never selects: the user picks an implementation per contract, and core's default renders until
 * they do, and whenever the chosen one throws.
 *
 * The props are view models declared here, not the service's run record: this package never
 * imports the contract (`test/boundary.test.ts`). Unlike an event's payload, a component's props
 * carry what its UI shows, the task's title included (spec `2026-09-19-component-host`, Q4a). A
 * core contract lands here in the same PR as the slot that renders it.
 */

/** The task a header shows. JSON. */
export interface TaskHeaderTask {
  readonly taskId: string
  /** The registered project that owns the task. Pass it as `TaskRef.projectId`. */
  readonly projectId: string
  /** The title the cockpit shows for the task: the user's, or the generated one. */
  readonly title: string
  /** `queued`, `running`, `waiting`, `review`, `done`, `failed` or `cancelled` today (the union may grow). */
  readonly status: string
}

/** The basic facts core's header shows under the title. JSON. */
export interface TaskHeaderMeta {
  /** The workflow's display name, e.g. `quick-task`. */
  readonly workflow: string
  /** The task's branch, once it has one. */
  readonly branch?: string
  /** Lines added and removed on the task's branch, once known. */
  readonly diff?: { readonly added: number; readonly removed: number }
}

export interface TaskHeaderMainProps {
  readonly task: TaskHeaderTask
  readonly meta: TaskHeaderMeta
  /** Plan progress, on the Session tab of a task that has a plan. */
  readonly plan?: { readonly done: number; readonly total: number }
}

/**
 * The presentational part of the task header: title, status and basic meta. Core renders the
 * task's actions, tabs, monitoring and dispatch lines and step rail around it, so an
 * implementation neither provides nor can remove them.
 * - `shows-title` (required): shows `task.title`.
 * - `shows-status` (required): shows `task.status`.
 * - `shows-meta` (optional): shows `meta`. The picker says which implementations do.
 * - Layout: 30 CSS pixels (one title row) are reserved while an implementation loads, fails or
 *   is swapped. The shell around it is sticky; this part is not.
 */
export const TaskHeaderMain = defineComponentContract<TaskHeaderMainProps>('cezar.task.header.main', {
  version: 1,
  requiredCapabilities: ['shows-title', 'shows-status'],
  optionalCapabilities: ['shows-meta'],
  layout: { minBlockSize: 30 },
})
