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

/**
 * One file sent with a continue prompt. The host refuses media types it cannot pass on.
 *
 * A hand-written mirror of the service's attachment shape — this package never imports the
 * contract — kept in step with it by a type test in the cockpit.
 */
export interface TaskAttachment {
  /** `image/*`, `text/plain`, `text/markdown`, `text/x-markdown` or `application/pdf`. */
  readonly mediaType: string
  /** Base64 payload, 1 to 7,000,000 characters. */
  readonly data: string
  /** At most 255 characters. */
  readonly name?: string
}

/**
 * Continue a task. Every field but the task is optional, and an omitted one keeps what the task
 * already has, so `{ taskId }` alone reopens the session exactly as it was. Switching the runner
 * or the model is a continue with that field: the service applies both only when it reopens a
 * session.
 */
export interface TaskContinueInput extends TaskRef {
  /** A backend this Cezar knows (`claude`, `codex`, …); omitted → the task's own. */
  readonly runner?: string
  /**
   * A model id of that runner; `''` is "auto" (the runner decides). Omitted → the task keeps its
   * model, except that a runner switch drops a pinned model that belongs to another runner.
   * Where models are locked, a non-blank model is refused.
   */
  readonly model?: string
  /**
   * A login of that runner. Omitted → the task keeps its account; an unknown account is refused.
   * A different account starts a fresh session: a session id lives inside one account's config
   * directory.
   */
  readonly agentProfile?: string
  /** The prompt the reopened session starts on. Omitted or blank → the engine's own "Continue.". */
  readonly text?: string
  /** Up to 4 files sent with `text`. */
  readonly attachments?: readonly TaskAttachment[]
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
