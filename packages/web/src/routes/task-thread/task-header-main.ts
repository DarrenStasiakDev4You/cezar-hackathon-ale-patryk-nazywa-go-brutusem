import { useEffect, useMemo, useRef, useState } from 'react'

import {
  useAgentProfiles,
  useConfig,
  useHealth,
  usePatchRun,
  useProjectRepoBase,
  useReferenceProjectId,
  useRuns,
  type ReferenceStatusEntry,
  type ReferenceStatusLookup,
} from '@/api/queries'
import { DEFAULT_AGENT_ACCOUNT_ID, type ApiRun } from '@open-mercato/cezar-api-client'
import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type TaskRef,
  type TaskHeaderActionState,
  type TaskHeaderMainProps,
  type TaskHeaderReference,
} from '@open-mercato/cezar-extension-api'
import { useCommand } from '@/commands/provider'
import { useTitleEditor, type TitleEditor } from '@/components/editable-title'
import { useReferenceLookup } from '@/components/reference-status'
import { toast } from '@/components/ui/toaster'
import { deriveAttention } from '@/lib/attention'
import { scopeTo, useActiveProjectId, useNavigate } from '@/lib/project-router'
import { queuePositions, runTitle } from '@/lib/task-groups'
import { prNumber, taskIssueUrl, taskPrUrl, taskReferences, workflowLabel, type TaskReference } from '@/lib/tasks-table'
import { usageMetricVisibility } from '@/lib/token-metrics'
import { isHttpUrl } from '@/lib/utils'

import { useAskAnswer, type AskAnswerDelivery } from './ask-answer'
import { useContinuationProvider } from './continuation-provider'
import { resolveConflictsPrompt, runActionFlags } from './run-actions'
import { useDraft } from './thread-draft'

/**
 * The task header's model (spec `.ai/specs/2026-09-19-task-header-contract.md`): the ONE reader of
 * the run behind `cezar.task.header.main@1`'s props and behind Continue, Stop and Archive. It turns
 * the run, the queries, the commands and the router into the contract's JSON data and its seven
 * intents, so core's default (`CoreTaskHeaderMain`) and any extension's implementation render the
 * same model, and the shell's own Continue, Cancel and Archive buttons draw from it too.
 *
 * Every field comes from the helper that fed the header before the split, so there is one rule per
 * fact. The shell's other rows (tabs, Finish, Pin, Mark unread, Delete, Terminal, the monitoring
 * and dispatch lines, the step rail, the resume hint) keep reading the run themselves.
 */

export interface TaskHeaderModel {
  /**
   * The contract's props. The data is frozen, and recomputed only when one of its inputs changes:
   * the run, the queue, health, the account list or a reference's look-up. The callbacks keep one
   * identity for the life of the header, and each call reads the latest run and state through a
   * ref, so after a switch from task A to task B (the header is not remounted) it acts on B.
   */
  readonly props: TaskHeaderMainProps
  /** Runs the stop. The shell calls it when the user confirms. */
  readonly stopTask: () => void
  /** Core's title editor: today's `useTitleEditor` with the saved draft (`useDraft(taskId, 'title')`) and `usePatchRun`. */
  readonly titleEditor: TitleEditor
}

export interface TaskHeaderModelOptions {
  readonly planTally?: { done: number; total: number }
  /** The shell's stop confirmation opener: `onStop` asks for confirmation, never stops. */
  readonly requestStopConfirmation: () => void
  /** The Session tab's dock picker focus (`useContinueAction().focusPicker`); absent on the Git tabs. */
  readonly chooseEngine?: () => void
}

/** The contract's data, without the intents. */
type TaskHeaderData = Omit<
  TaskHeaderMainProps,
  'onContinue' | 'onStop' | 'onArchive' | 'onRename' | 'onResolveConflicts' | 'onNavigate' | 'onChooseEngine'
>

type Intents = Pick<
  TaskHeaderMainProps,
  'onContinue' | 'onStop' | 'onArchive' | 'onRename' | 'onResolveConflicts' | 'onNavigate' | 'onChooseEngine'
> & { readonly stopTask: () => void }

/** Values `onNavigate` already warned about, once per value per page load. */
const warnedNavigations = new Set<string>()

/** The only reader of the run behind the part's props and the three actions. `requestStopConfirmation` is the shell's dialog opener. */
export function useTaskHeaderModel(run: ApiRun, options: TaskHeaderModelOptions): TaskHeaderModel {
  const flags = runActionFlags(run)

  // The queue position a parked run shows in its pill ("queued #2"). Reads the shared runs-list
  // query — already warm from the sidebar quick-list — because position is a property of the
  // whole queue, not of this record.
  const queuePosition = useRuns(
    useMemo(
      () => (runs: ApiRun[]) => (run.status === 'queued' ? queuePositions(runs).get(run.id) : undefined),
      [run.id, run.status],
    ),
  ).data
  const health = useHealth()
  // `/api/health` describes the boot project and can name the wrong runner on scoped routes, so
  // the default runner comes from the active project's config (the badge's rule before the split).
  const config = useConfig()
  const profiles = useAgentProfiles()
  // #526: an issue link may be synthesized from the CEZ:ISSUE marker, and the only repository such
  // a link may name is the one on screen — never the transcript's.
  const repoBase = useProjectRepoBase()
  const referenceProjectId = useReferenceProjectId()
  const activeProjectId = useActiveProjectId()
  const navigate = useNavigate()

  // The references go through the same seam as every other surface's chips, which is what keeps
  // the header and the Tasks table answering identically for the same PR.
  const references = useMemo(() => taskReferences(run, repoBase), [run, repoBase])
  const requests = useMemo(
    () =>
      referenceProjectId === undefined
        ? []
        : references.map((reference) => ({ projectId: referenceProjectId, kind: reference.kind, number: reference.number })),
    [references, referenceProjectId],
  )
  const lookup = useReferenceLookup(requests)

  // Continue, Stop and Archive are commands (spec 2026-09-19-command-api): the handler owns the
  // request and the cache rule, the 409 refetch included, so what stays here is the state the
  // part renders and the toast with the server's words. Pending is the task's own: the header is
  // not remounted between tasks, so a request still in flight for task A must not disable task B's
  // buttons. `inFlight` names the task each command is running for, and refuses a repeat for that
  // task made before the pending state has rendered.
  const inFlight = useRef<{ continue?: string; stop?: string; archive?: string; resolveConflicts: boolean }>({
    resolveConflicts: false,
  })
  const showError = (error: Error) => toast(error.message, { tone: 'danger' })
  const settled = (action: 'continue' | 'stop' | 'archive') => (_data: unknown, _error: unknown, input: TaskRef) => {
    if (inFlight.current[action] === input.taskId) inFlight.current[action] = undefined
  }
  const continueCommand = useCommand(TaskContinue, { onError: showError, onSettled: settled('continue') })
  const stopCommand = useCommand(TaskStop, { onError: showError, onSettled: settled('stop') })
  const archiveCommand = useCommand(TaskArchive, { onError: showError, onSettled: settled('archive') })
  const pendingHere = (command: { readonly isPending: boolean; readonly variables?: TaskRef }): boolean =>
    command.isPending && command.variables?.taskId === run.id
  const continuation = useContinuationProvider(run)
  // "Resolve conflicts" rides the same delivery as an Ask answer: a live message, or a continue
  // for a task parked at review.
  const delivery = useAskAnswer(run)
  const [resolving, setResolving] = useState(false)
  const titleEditor = useCoreTitleEditor(run)

  const metricVisibility = usageMetricVisibility(health.data)
  const headerReferences = referencesOf(run, references, repoBase, referenceProjectId, lookup)
  const conflicting = headerReferences.some((reference) => conflictingPr(reference) !== undefined)
  const attention = deriveAttention(run)
  const usage = {
    ...(metricVisibility.tokens && run.inputTokens !== undefined ? { inputTokens: run.inputTokens } : {}),
    ...(metricVisibility.tokens && run.outputTokens !== undefined ? { outputTokens: run.outputTokens } : {}),
    ...(metricVisibility.cost && run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
  }
  const automationHref =
    run.automation && health.data?.capabilities?.automations === true
      ? String(scopeTo(activeProjectId, `/automations/${encodeURIComponent(run.automation.automationId)}/log`))
      : undefined

  const data = useFrozenJson<TaskHeaderData>({
    task: {
      taskId: run.id,
      // Every task route lives under `/p/:projectId/`, so `''` is seen only by a bare test render
      // at an unscoped path.
      projectId: activeProjectId ?? '',
      title: runTitle(run),
      prompt: run.task,
      status: run.status,
      archived: Boolean(run.archived),
    },
    attention: {
      label: attention.label,
      tone: attention.tone,
      pulse: attention.pulse,
      ...(queuePosition !== undefined ? { queuePosition } : {}),
    },
    engine: engineOf(run, config.data?.defaultRunner, profiles.data?.profiles),
    meta: {
      // `workflowLabel` so an inline chain shows its first step's name, not the bare "(planned)"
      // placeholder — which reads like a status next to the live status pill.
      workflow: workflowLabel(run),
      ...(run.branch ? { branch: run.branch } : {}),
      ...(run.diffStat
        ? {
            diff: {
              added: run.diffStat.adds,
              removed: run.diffStat.dels,
              files: run.diffStat.files,
              ...(run.diffStat.repointed ? { repointed: true } : {}),
            },
          }
        : {}),
      ...(headerReferences.length > 0 ? { references: headerReferences } : {}),
      // Provenance is history and is always shown; only the LINK is gated on the capability.
      ...(run.automation
        ? {
            automation: {
              automationId: run.automation.automationId,
              ...(automationHref !== undefined ? { href: automationHref } : {}),
            },
          }
        : {}),
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    },
    ...(options.planTally ? { plan: { done: options.planTally.done, total: options.planTally.total } } : {}),
    actions: {
      // No usable agent provider: offered, but not runnable, with the provider's reason.
      continue: actionState(flags.continueRun, pendingHere(continueCommand), {
        blocked: !continuation.canContinue,
        reason: continuation.reason,
      }),
      stop: actionState(flags.cancel, pendingHere(stopCommand)),
      archive: actionState(flags.archive, pendingHere(archiveCommand)),
      // One delivery seam per header, so this one stays pending across a task switch: a second send
      // while it is busy would be refused by the seam and read as sent.
      resolveConflicts: actionState(conflicting, resolving || delivery.isPending, {
        blocked: Boolean(delivery.blockedBy),
        reason: delivery.reason,
      }),
      // The same gate the dock uses to show its picker.
      chooseEngine: actionState(options.chooseEngine !== undefined && flags.continueRun, false),
    },
  })

  // What each intent reads when it is called: the render the user is looking at, never the one
  // the callbacks were created in.
  const latest = useRef({ run, data, options, continuation, delivery, titleEditor, automationHref })
  latest.current = { run, data, options, continuation, delivery, titleEditor, automationHref }
  const commands = useRef({ continueCommand, stopCommand, archiveCommand, navigate })
  commands.current = { continueCommand, stopCommand, archiveCommand, navigate }

  const [intents] = useState<Intents>(() => {
    const allowed = (state: TaskHeaderActionState): boolean => state.available && state.enabled && !state.pending
    return {
      onContinue: () => {
        const { run: current, data: now, continuation: provider } = latest.current
        if (!allowed(now.actions.continue) || inFlight.current.continue === current.id) return
        inFlight.current.continue = current.id
        const { runnerOverride } = provider
        commands.current.continueCommand.mutate(
          runnerOverride === undefined ? { taskId: current.id } : { taskId: current.id, runner: runnerOverride },
        )
      },
      onStop: () => {
        if (!allowed(latest.current.data.actions.stop)) return
        latest.current.options.requestStopConfirmation()
      },
      stopTask: () => {
        const taskId = latest.current.run.id
        if (inFlight.current.stop === taskId) return
        inFlight.current.stop = taskId
        commands.current.stopCommand.mutate({ taskId })
      },
      onArchive: () => {
        const { run: current, data: now } = latest.current
        if (!allowed(now.actions.archive) || inFlight.current.archive === current.id) return
        inFlight.current.archive = current.id
        // Toggling off the record: an archived run is restored.
        commands.current.archiveCommand.mutate({ taskId: current.id, archived: !current.archived })
      },
      onRename: () => latest.current.titleEditor.begin(),
      onResolveConflicts: (prNumberToResolve: number) => {
        const { data: now, delivery: seam } = latest.current
        if (!allowed(now.actions.resolveConflicts) || inFlight.current.resolveConflicts) return
        // Only a pull request these props call conflicting: a reference known by URL alone has no
        // number to look up, so it never qualifies.
        const isConflicting = (now.meta.references ?? []).some(
          (reference) => conflictingPr(reference) === prNumberToResolve,
        )
        if (!isConflicting) return
        inFlight.current.resolveConflicts = true
        setResolving(true)
        void resolveConflicts(seam, prNumberToResolve).finally(() => {
          inFlight.current.resolveConflicts = false
          setResolving(false)
        })
      },
      onNavigate: (href: string) => {
        const allowedHref = latest.current.automationHref
        if (allowedHref !== undefined && href === allowedHref) {
          void commands.current.navigate(href)
          return
        }
        const value = String(href)
        if (warnedNavigations.has(value)) return
        warnedNavigations.add(value)
        console.warn(`[cezar:extensions] the task header ignored onNavigate(${JSON.stringify(value)}): not a link its props carry`)
      },
      onChooseEngine: () => {
        const { data: now, options: current } = latest.current
        if (!allowed(now.actions.chooseEngine)) return
        current.chooseEngine?.()
      },
    }
  })

  const props = useMemo<TaskHeaderMainProps>(
    () =>
      Object.freeze({
        ...data,
        onContinue: intents.onContinue,
        onStop: intents.onStop,
        onArchive: intents.onArchive,
        onRename: intents.onRename,
        onResolveConflicts: intents.onResolveConflicts,
        onNavigate: intents.onNavigate,
        onChooseEngine: intents.onChooseEngine,
      }),
    [data, intents],
  )

  return { props, stopTask: intents.stopTask, titleEditor }
}

/** One action's state: offered, runnable now, in flight, and — when something blocks it — why not. */
function actionState(
  available: boolean,
  pending: boolean,
  block: { readonly blocked: boolean; readonly reason?: string } = { blocked: false },
): TaskHeaderActionState {
  return {
    available,
    enabled: available && !pending && !block.blocked,
    pending,
    ...(block.blocked && block.reason ? { reason: block.reason } : {}),
  }
}

/** The PR number of a numbered, `conflicting` pull request reference, else `undefined`. */
function conflictingPr(reference: TaskHeaderReference): number | undefined {
  return reference.kind === 'pr' && reference.number !== undefined && reference.conflicting === true
    ? reference.number
    : undefined
}

/**
 * The header's references, in the order it paints them: EVERY PR the task points at, in
 * `taskReferences` order — the same order, and the same statuses, the global Tasks table paints —
 * then a PR known only by a URL whose last segment is not a number (`taskPrUrl`'s own tolerance),
 * then the issue. Each numbered one carries what the look-up knows about it.
 */
function referencesOf(
  run: ApiRun,
  references: readonly TaskReference[],
  repoBase: string | undefined,
  projectId: string | undefined,
  lookup: ReferenceStatusLookup,
): TaskHeaderReference[] {
  const known = (kind: 'PR' | 'Issue', number: number | undefined): Partial<TaskHeaderReference> =>
    projectId === undefined || number === undefined ? {} : lookupOf(lookup({ projectId, kind, number }))
  const result: TaskHeaderReference[] = []
  const prReferences = references.filter((reference) => reference.kind === 'PR')
  for (const reference of prReferences) {
    result.push({
      kind: 'pr',
      number: reference.number,
      // A reference with no usable URL still gets its chip, as All tasks paints it: inert text.
      ...(reference.url && isHttpUrl(reference.url) ? { url: reference.url } : {}),
      ...known('PR', reference.number),
    })
  }
  // Gated on that URL not being painted already, NOT on there being no chips at all: a forge whose
  // PR URLs do not end in a number would otherwise lose the link behind a number-only chip.
  const prUrl = taskPrUrl(run)
  if (prUrl && isHttpUrl(prUrl) && !prReferences.some((reference) => reference.url === prUrl)) {
    result.push({ kind: 'pr', url: prUrl })
  }
  const issueUrl = taskIssueUrl(run, repoBase)
  if (issueUrl && isHttpUrl(issueUrl)) {
    const number = prNumber(issueUrl)
    result.push({
      kind: 'issue',
      ...(number ? { number: Number(number) } : {}),
      url: issueUrl,
      ...known('Issue', number ? Number(number) : undefined),
    })
  }
  return result
}

/**
 * A look-up entry as the contract spells it. `idle` (nothing asked on this surface yet, or past the
 * per-project cap) is an absent `lookup`, but it still carries what was learned before — the last
 * known status and conflict flag — as the chip always painted them.
 */
function lookupOf(entry: ReferenceStatusEntry): Partial<TaskHeaderReference> {
  return {
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.state !== 'idle' ? { lookup: entry.state } : {}),
    ...(entry.state === 'unavailable' && entry.reason ? { lookupReason: entry.reason } : {}),
    ...(entry.conflicting !== undefined ? { conflicting: entry.conflicting } : {}),
  }
}

/**
 * The agent the task runs on, resolved as the badge always resolved it. The record keeps only what
 * the caller ASKED for, while the run executes as `input.runner ?? config.defaultRunner`; 'claude'
 * is the last resort only while the active project's config is in flight. The account is read from
 * the STEP that actually spawned (spec 2026-07-29-agent-profiles), and the canonical identity
 * (#405, #546) only when it says something `model` does not.
 */
function engineOf(
  run: ApiRun,
  defaultRunner: string | undefined,
  profiles: readonly { id: string; label: string }[] | undefined,
): TaskHeaderMainProps['engine'] {
  const runner = run.runner ?? defaultRunner ?? 'claude'
  const model = run.model ?? 'auto'
  const accountId = [...run.steps].reverse().find((step) => step.profileId)?.profileId
  const account =
    accountId === undefined
      ? undefined
      : accountId === DEFAULT_AGENT_ACCOUNT_ID
        ? 'default'
        : // A deleted account still names the folder this run's sessions live in, so the id is
          // shown rather than swallowed — "gone" is the useful half of that answer.
          (profiles?.find((profile) => profile.id === accountId)?.label ?? `${accountId} (removed)`)
  const identity = run.modelIdentity && run.modelIdentity !== model ? run.modelIdentity : undefined
  return {
    runner,
    model,
    ...(account !== undefined ? { account } : {}),
    ...(identity !== undefined ? { identity } : {}),
  }
}

/**
 * Sends the conflict prompt and says how it went where the user acted: the part's panel is gone
 * by the time this resolves. Saying that a FINISHED task was reopened matters most, because that
 * is a state change the user did not explicitly ask for.
 */
async function resolveConflicts(delivery: AskAnswerDelivery, prNumberToResolve: number): Promise<void> {
  // Read BEFORE the send: delivering flips a parked task to `running`.
  const reopened = delivery.mode === 'resume'
  const failure = await delivery.send(resolveConflictsPrompt(prNumberToResolve))
  if (failure) toast(failure, { tone: 'danger' })
  else toast(`${reopened ? 'Task reopened' : 'Sent to the task'} — resolving conflicts in PR #${prNumberToResolve}`)
}

/**
 * The title editor (#389) with the saved draft (#939): Enter commits through `usePatchRun` (the
 * server stores it as both `title` and `titleSummary`), Escape abandons the draft, and a draft
 * saved on another visit reopens the editor. The rename machine itself is shared with the Tasks
 * table (`components/editable-title.tsx`).
 */
function useCoreTitleEditor(run: ApiRun): TitleEditor {
  const patch = usePatchRun(run.id)
  const draft = useDraft(run.id, 'title')
  const editor = useTitleEditor(runTitle(run), (next) =>
    patch.mutate({ title: next }, { onError: (error) => toast(error.message, { tone: 'danger' }) }),
  )

  const begin = useRef(editor.beginWith)
  begin.current = editor.beginWith
  const editing = editor.editing
  useEffect(() => {
    if (editing || !draft.ready || !draft.hasDraft) return
    begin.current(draft.text)
  }, [draft.hasDraft, draft.ready, draft.text, editing])

  return {
    ...editor,
    setDraft: (value) => {
      editor.setDraft(value)
      draft.setText(value)
    },
    commit: () => {
      editor.commit()
      draft.clear()
    },
    cancel: () => {
      editor.cancel()
      draft.clear()
    },
  }
}

/**
 * `value`, frozen all the way down, keeping the previous object while the JSON is the same: the
 * contract's data is JSON, so equal JSON is equal data, and a memoized implementation re-renders
 * only when something it shows changed.
 */
function useFrozenJson<T>(value: T): T {
  const key = JSON.stringify(value)
  const kept = useRef<{ key: string; value: T } | null>(null)
  if (kept.current === null || kept.current.key !== key) kept.current = { key, value: deepFreeze(value) }
  return kept.current.value
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
