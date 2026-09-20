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
export interface TaskHeaderEngine {
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
export interface TaskHeaderReference {
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

/** The basic facts core's header shows under the title. JSON. */
export interface TaskHeaderMeta {
  /** The workflow's display name, e.g. `quick-task`. */
  readonly workflow: string
  readonly branch?: string
  /**
   * Lines added and removed on the task's branch, and the number of files, once known.
   * `repointed`: measured against another branch the agent checked out into the task's worktree
   * (#751), so the numbers count only what the task did to it.
   */
  readonly diff?: { readonly added: number; readonly removed: number; readonly files: number; readonly repointed?: boolean }
  /** Every pull request, then the issue, in the order the Tasks table shows them. */
  readonly references?: readonly TaskHeaderReference[]
  /** The automation that launched the task. `href` (a project-scoped cockpit path) is set while the automations page is available. */
  readonly automation?: { readonly automationId: string; readonly href?: string }
  /** The usage this server shows. A metric the server hides (`CEZ_HIDE_TOKEN_METRICS`) is absent. */
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: number }
}

/** Whether an action is offered, and whether it can run now. JSON. */
export interface TaskHeaderActionState {
  /** The task's state allows the action: render its control. */
  readonly available: boolean
  /** It can run now. `false` while `pending`, or for the `reason` given. */
  readonly enabled: boolean
  /** A request for it is in flight. */
  readonly pending: boolean
  /** Why it cannot run, in words for the user, e.g. "Connect an agent provider to continue." */
  readonly reason?: string
}

/** Whether an action is offered, and whether it can run now. JSON. */
export type TaskActionState = TaskHeaderActionState

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

/** A file the user picked, pasted or dropped. A browser `File` fits structurally. */
export interface TaskComposerFile {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** An attachment held by the draft. JSON. */
export interface TaskComposerAttachment {
  readonly key: string
  readonly name: string
  readonly mediaType: string
  readonly isImage: boolean
  readonly preview?: string
}

/** What the user has written and not sent yet. JSON. */
export interface TaskComposerDraft {
  readonly text: string
  readonly attachments: readonly TaskComposerAttachment[]
}

/** What a send does now, and the words shown by core. JSON. */
export interface TaskComposerStatus {
  /** `reply`, `queued`, `continue` or `closed` today; unknown modes are read as `closed`. */
  readonly mode: string
  readonly placeholder: string
  readonly submitLabel: string
}

/** Whether the box takes input at all. JSON. */
export interface TaskComposerAvailability {
  readonly enabled: boolean
  readonly reason?: string
  readonly fix?: { readonly label: string; readonly href: string }
}

/** What the user may do in the box now. */
export interface TaskComposerActions {
  readonly submit: TaskActionState
  readonly attach: TaskActionState
  readonly chooseRunner: TaskActionState
  readonly chooseModel: TaskActionState
}

/** One runner, or one login of a runner that has several. JSON. */
export interface TaskComposerRunnerChoice {
  readonly runner: string
  readonly account?: string
  readonly label: string
  readonly description?: string
}

/** The engine a continuation uses and the choices available to the user. JSON. */
export interface TaskComposerEngine {
  readonly runner: string
  readonly account?: string
  readonly model: string
  readonly modelLabel: string
  readonly runnerChoices: readonly TaskComposerRunnerChoice[]
  readonly modelChoices: readonly {
    readonly id: string
    readonly label: string
    readonly description?: string
  }[]
  readonly modelNote?: string
}

/** A skill offered by the `/` menu. JSON. */
export interface TaskComposerSkill {
  readonly key: string
  readonly name: string
  readonly description?: string
  readonly project: boolean
  readonly uses: number
}

/** A completion list loaded on request. JSON. */
export interface TaskComposerCompletionList<T> {
  readonly status: string
  readonly items: readonly T[]
}

export interface TaskComposerCompletions {
  readonly skills: TaskComposerCompletionList<TaskComposerSkill>
  readonly files: TaskComposerCompletionList<string>
}

export interface TaskComposerProps {
  readonly task: { readonly taskId: string; readonly projectId: string }
  readonly draft: TaskComposerDraft
  readonly status: TaskComposerStatus
  readonly availability: TaskComposerAvailability
  readonly actions: TaskComposerActions
  readonly engine?: TaskComposerEngine
  readonly completions: TaskComposerCompletions
  readonly limits: {
    readonly maxAttachments: number
    readonly maxAttachmentBytes: number
    readonly accept: string
  }
  readonly onTextChange: (text: string) => void
  readonly onSubmit: () => void
  readonly onAttachFiles: (files: readonly TaskComposerFile[], source: 'file' | 'clipboard') => void
  readonly onRemoveAttachment: (key: string) => void
  readonly onSelectRunner: (runner: string, account?: string) => void
  readonly onSelectModel: (model: string) => void
  readonly onRequestCompletions: (kind: 'skills' | 'files') => void
  readonly onUseSkill: (name: string) => void
  readonly onNavigate: (href: string) => void
}

/**
 * The task's reply box. Core owns the draft, delivery, engine choice and completion lists;
 * implementations render the model and report user actions through the nine intents below.
 * Data props are JSON. `onAttachFiles` is the one intent with a structural browser-file argument.
 *
 * - `edits-draft`, `sends` and `shows-availability` are always required.
 * - `attaches-files` and `chooses-engine` are optional in phase 2; core renders safe fallbacks
 *   beside an implementation that does not declare them.
 * - The host reserves 88 CSS pixels while an implementation loads, fails or is swapped.
 */
export const TaskComposer = defineComponentContract<TaskComposerProps>('cezar.task.composer', {
  version: 1,
  requiredCapabilities: ['edits-draft', 'sends', 'shows-availability'],
  optionalCapabilities: ['attaches-files', 'chooses-engine'],
  layout: { minBlockSize: 88 },
})
