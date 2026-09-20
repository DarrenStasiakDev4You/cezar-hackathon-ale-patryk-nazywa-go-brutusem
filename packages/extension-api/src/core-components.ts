import { defineComponentContract } from './components.ts'

/**
 * Core's public component contracts — the `cezar.*` tokens the cockpit renders through its
 * component host, and any extension may implement through `context.components.provide`. Providing
 * never selects: the user picks an implementation per contract, and core's default renders until
 * they do, and whenever the chosen one throws.
 *
 * The props are view models declared here, not the service's run record: this package never
 * imports the contract (`test/boundary.test.ts`). Data props are JSON; the only functions are
 * intents that return nothing, and core decides what each one does (spec
 * `2026-09-19-task-header-contract`). A core contract lands here in the same PR as the slot that
 * renders it.
 */

/** The task a header shows. JSON. */
export interface TaskHeaderTask {
  readonly taskId: string
  /** The registered project that owns the task. Pass it as `TaskRef.projectId`. */
  readonly projectId: string
  /** The title the cockpit shows for the task: the user's, or the generated one. */
  readonly title: string
  /** The text the task was started with. Core shows it when the pointer rests on the title. */
  readonly prompt: string
  /** `queued`, `running`, `waiting`, `review`, `done`, `failed` or `cancelled` today (the union may grow). */
  readonly status: string
  /** Archived tasks offer Unarchive instead of Archive. */
  readonly archived: boolean
}

/** How the status reads: the words, colour and motion of the task list's dot. JSON. */
export interface TaskHeaderAttention {
  /** A lower-case phrase, e.g. `running`, `needs you`, `queued`. */
  readonly label: string
  /** `success`, `pending`, `danger`, `violet` or `neutral` today. The set may grow: read an unknown tone as `neutral`. */
  readonly tone: string
  /** True while the task is changing state. */
  readonly pulse: boolean
  /** The 1-based place in the project's queue, for a queued task. */
  readonly queuePosition?: number
}

/** The agent the task runs on. JSON. */
export interface TaskMetadataEngine {
  /** `claude`, `codex`, `opencode`, …: the task's runner, or the project's default when the task named none. */
  readonly runner: string
  /** The model the task asked for, or `auto` when the runner picks. */
  readonly model: string
  /** The account the last agent step ran under, when one was recorded. A removed account reads `<id> (removed)`. */
  readonly account?: string
  /** The `provider/model` the run resolved to, when it differs from `model`. */
  readonly identity?: string
}

/** A pull request or issue the task points at. JSON. */
export interface TaskMetadataReference {
  readonly kind: 'pr' | 'issue'
  readonly number?: number
  /** An http(s) URL, when one is known. */
  readonly url?: string
  /**
   * The forge's last known answer about it: `draft`, `review-required`, `changes-requested`,
   * `checks-pending`, `checks-failing`, `ready`, `merged`, `closed`, `open`, `completed` or
   * `not-planned` today. The set may grow: read an unknown value as absent. Absent: nothing known.
   */
  readonly status?: string
  /**
   * How the look-up behind `status` stands: `loading`, `ready`, `unknown` (the forge has no such
   * number) or `unavailable` (the forge could not be reached, so `status` is only the last known
   * answer). Absent: nothing asked, e.g. a reference without a number.
   */
  readonly lookup?: string
  /** Why the look-up is `unavailable`, in words for the user. */
  readonly lookupReason?: string
  /** `true` when the pull request has merge conflicts. Absent means unknown, never "clean". */
  readonly conflicting?: boolean
}

/** Whether an action is offered, and whether it can run now. JSON. */
export interface TaskActionState {
  /** The task's state allows the action: render its control. */
  readonly available: boolean
  /** It can run now. `false` while `pending`, or for the `reason` given. */
  readonly enabled: boolean
  /** A request for it is in flight. */
  readonly pending: boolean
  /** Why it cannot run, in words for the user, e.g. "Connect an agent provider to continue." */
  readonly reason?: string
}

/** The task's metadata: the facts about how it was started, where it works and what it cost. JSON. */
export interface TaskMetadataModel {
  /** The workflow's display name, e.g. `quick-task`. */
  readonly workflow: string
  readonly branch?: string
  /**
   * Lines added and removed on the task's branch, and the number of files, once known (#37's TSDoc).
   */
  readonly diff?: { readonly added: number; readonly removed: number; readonly files: number; readonly repointed?: boolean }
  /** Every pull request, then the issue, in the order the Tasks table shows them. */
  readonly references?: readonly TaskMetadataReference[]
  /** The automation that launched the task. `href` is set while the automations page is available. */
  readonly automation?: { readonly automationId: string; readonly href?: string }
  /** The usage this server shows. A metric the server hides (`CEZ_HIDE_TOKEN_METRICS`) is absent. */
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: number }
  readonly engine: TaskMetadataEngine
}

// The header's names stay as aliases of the shared model. This keeps its public props unchanged.
export type TaskHeaderMeta = Omit<TaskMetadataModel, 'engine'>
export type TaskHeaderEngine = TaskMetadataEngine
export type TaskHeaderReference = TaskMetadataReference
export type TaskHeaderActionState = TaskActionState

/** The task the metadata belongs to. JSON. */
export interface TaskMetadataTaskRef {
  readonly id: string
  /** The registered project that owns the task. Pass it as `TaskRef.projectId`. */
  readonly projectId: string
  /** The title the cockpit shows for the task. Core uses it in its chips' accessible names. */
  readonly title: string
}

/** Whether each metadata action can run now. JSON. */
export interface TaskMetadataActions {
  /** Ask the task's agent to resolve a pull request's merge conflicts. Offer it on a numbered, `conflicting` reference. */
  readonly resolveConflicts: TaskActionState
  /** Choose the runner and model the next continuation uses. */
  readonly chooseEngine: TaskActionState
}

/** The user actions core offers for the metadata component. */
export interface TaskMetadataIntents {
  /** The user asked the agent to resolve conflicts in pull request `prNumber`, a `conflicting` reference. */
  readonly resolveConflicts?: (prNumber: number) => void
  /** The user followed an in-app link from these props (`metadata.automation.href`). Any other value does nothing. */
  readonly navigate?: (href: string) => void
  /** The user asked to choose the engine for the next continuation. Core moves focus to its engine picker. */
  readonly chooseEngine?: () => void
}

export interface TaskMetadataProps {
  readonly task: TaskMetadataTaskRef
  readonly metadata: TaskMetadataModel
  readonly actions: TaskMetadataActions
  readonly intents: TaskMetadataIntents
}

export interface TaskHeaderActions {
  /** Reopen the task's last agent session. */
  readonly continue: TaskHeaderActionState
  /** Stop an active task. Core labels it **Cancel** and asks the user to confirm. */
  readonly stop: TaskHeaderActionState
  /** Archive the task, or restore it when `task.archived`. */
  readonly archive: TaskHeaderActionState
  /** Ask the task's agent to resolve a pull request's merge conflicts. Offer it on a numbered, `conflicting` reference. */
  readonly resolveConflicts: TaskHeaderActionState
  /** Choose the runner and model the next continuation uses. Available on the Session tab, for a task that can be continued. */
  readonly chooseEngine: TaskHeaderActionState
}

export interface TaskHeaderMainProps {
  readonly task: TaskHeaderTask
  readonly attention: TaskHeaderAttention
  readonly engine: TaskHeaderEngine
  readonly meta: TaskHeaderMeta
  /** Plan progress, on the Session tab of a task that has a plan. */
  readonly plan?: { readonly done: number; readonly total: number }
  readonly actions: TaskHeaderActions
  /** The user asked to continue the task. */
  readonly onContinue: () => void
  /** The user asked to stop the task. Core asks them to confirm first. */
  readonly onStop: () => void
  /** The user asked to archive the task, or to restore it when it is archived. */
  readonly onArchive: () => void
  /** The user asked to rename the task. Core shows its title editor over this part until they save or cancel. */
  readonly onRename: () => void
  /** The user asked the agent to resolve conflicts in pull request `prNumber`, a `conflicting` reference. */
  readonly onResolveConflicts: (prNumber: number) => void
  /** The user followed an in-app link from these props (`meta.automation.href`). */
  readonly onNavigate: (href: string) => void
  /** The user asked to choose the engine for the next continuation. Core moves focus to its engine picker. */
  readonly onChooseEngine: () => void
}

/**
 * The presentational part of the task header, and the header's public model: the task, its status,
 * its engine, its basic facts and the state of its main actions. Core renders the tabs, Finish,
 * Open in, Notes, Mark unread, Pin, Delete, the monitoring and dispatch lines and the step rail
 * around it, so an implementation neither provides nor can remove them.
 * - `shows-title` (required): shows `task.title`.
 * - `shows-status` (required): shows the status, from `attention`.
 * - `shows-meta` (optional): shows `meta` and `engine`. The picker says which implementations do.
 * - `offers-continue`, `offers-stop`, `offers-archive` (optional): renders that action from
 *   `actions` and calls its intent (`onContinue`, `onStop`, `onArchive`). Core then leaves that
 *   action out of its action bar, and while any of the three is offered it keeps its Run actions
 *   menu, which lists them too, visible at every width. For an action it does not declare, core
 *   renders the action beside this part, and the implementation should not.
 * - Intents: before acting on `onContinue`, `onStop`, `onArchive`, `onResolveConflicts` or
 *   `onChooseEngine`, core checks the action's current state. A call does nothing unless the
 *   action is `available` and `enabled`, which also rules out a repeat while one is `pending`.
 * - Layout: 30 CSS pixels (one title row) are reserved while an implementation loads, fails or
 *   is swapped. Core's title editor covers this band while the user renames. The shell around it
 *   is sticky; this part is not.
 */
export const TaskHeaderMain = defineComponentContract<TaskHeaderMainProps>('cezar.task.header.main', {
  version: 1,
  requiredCapabilities: ['shows-title', 'shows-status'],
  optionalCapabilities: ['shows-meta', 'offers-continue', 'offers-stop', 'offers-archive'],
  layout: { minBlockSize: 30 },
})

/**
 * The task's metadata: workflow, branch, references, diff summary, automation, usage and cost, and
 * the agent it runs on. Core places the box and owns its visibility; implementations must wrap or
 * truncate at any width rather than assuming a position on the page.
 */
export const TaskMetadata = defineComponentContract<TaskMetadataProps>('cezar.task.metadata', {
  version: 1,
  requiredCapabilities: ['shows-metadata'],
  optionalCapabilities: ['offers-links', 'offers-copy'],
  layout: { minBlockSize: 20 },
})
