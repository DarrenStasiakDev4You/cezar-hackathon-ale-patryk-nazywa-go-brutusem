import { defineCommand } from './commands.ts'

/**
 * Core's public commands — the `cezar.*` tokens the cockpit registers and any extension may
 * execute through `context.commands`. Each takes exactly one JSON input object; unknown keys are
 * ignored, so an extension built against a later input shape still runs. The host validates the
 * input before anything is sent: a malformed one rejects with `invalid-input`.
 *
 * The results are narrow view models declared here, not the service's run record: this package
 * never imports the contract (`test/boundary.test.ts`).
 */

/** One task. `projectId` omitted → the project the cockpit is currently showing. */
export interface TaskRef {
  readonly taskId: string
  readonly projectId?: string
}

export interface TaskContinueInput extends TaskRef {
  /** A backend this Cezar knows (`claude`, `codex`, …); omitted → the task's own. */
  readonly runner?: string
}

export interface TaskArchiveInput extends TaskRef {
  /** `false` restores the task to the live list. Default `true`. */
  readonly archived?: boolean
}

export interface TaskContinueResult {
  readonly taskId: string
  readonly continued: true
}

export interface TaskStopResult {
  readonly taskId: string
  /** The service's answer: `false` when there was nothing running to stop. */
  readonly stopped: boolean
}

export interface TaskArchiveResult {
  readonly taskId: string
  /** The task's archive state after the call. */
  readonly archived: boolean
}

/** Reopens a finished task's agent session. Rejects `command-failed` (with the service's words) when it cannot be resumed. */
export const TaskContinue = defineCommand<[input: TaskContinueInput], TaskContinueResult>('cezar.task.continue')

/** Stops a running task. */
export const TaskStop = defineCommand<[input: TaskRef], TaskStopResult>('cezar.task.stop')

/** Archives a task, or restores it with `archived: false`. */
export const TaskArchive = defineCommand<[input: TaskArchiveInput], TaskArchiveResult>('cezar.task.archive')
