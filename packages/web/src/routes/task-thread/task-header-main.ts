import { useEffect, useMemo, useRef, useState } from 'react'

import { usePatchRun, useRuns } from '@/api/queries'
import type { ApiRun } from '@open-mercato/cezar-api-client'
import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type TaskRef,
  type TaskHeaderActionState,
  type TaskHeaderMainProps,
  type TaskMetadataProps,
} from '@open-mercato/cezar-extension-api'
import { useCommand } from '@/commands/provider'
import { useTitleEditor, type TitleEditor } from '@/components/editable-title'
import { toast } from '@/components/ui/toaster'
import { deriveAttention } from '@/lib/attention'
import { useActiveProjectId } from '@/lib/project-router'
import { queuePositions, runTitle } from '@/lib/task-groups'
import { useFrozenJson } from '@/lib/use-frozen-json'

import { useContinuationProvider } from './continuation-provider'
import { runActionFlags } from './run-actions'
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
  /** The shared metadata controller's props. */
  readonly metadata: TaskMetadataProps
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

/** The only reader of the run behind the part's props and the three actions. `requestStopConfirmation` is the shell's dialog opener. */
export function useTaskHeaderModel(run: ApiRun, options: TaskHeaderModelOptions): TaskHeaderModel {
  const flags = runActionFlags(run)
  const activeProjectId = useActiveProjectId()
  const queuePosition = useRuns(
    useMemo(
      () => (runs: ApiRun[]) => (run.status === 'queued' ? queuePositions(runs).get(run.id) : undefined),
      [run.id, run.status],
    ),
  ).data
  const attention = deriveAttention(run)

  // Continue, Stop and Archive are commands (spec 2026-09-19-command-api): the handler owns the
  // request and the cache rule, the 409 refetch included, so what stays here is the state the
  // part renders and the toast with the server's words. Pending is the task's own: the header is
  // not remounted between tasks, so a request still in flight for task A must not disable task B's
  // buttons. `inFlight` names the task each command is running for, and refuses a repeat for that
  // task made before the pending state has rendered.
  const inFlight = useRef<{ continue?: string; stop?: string; archive?: string }>({})
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
  const titleEditor = useCoreTitleEditor(run)
  const metadata = options.metadata
  const { engine, ...meta } = metadata.metadata

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
    engine,
    meta,
    ...(options.planTally ? { plan: { done: options.planTally.done, total: options.planTally.total } } : {}),
    actions: {
      // No usable agent provider: offered, but not runnable, with the provider's reason.
      continue: actionState(flags.continueRun, pendingHere(continueCommand), {
        blocked: !continuation.canContinue,
        reason: continuation.reason,
      }),
      stop: actionState(flags.cancel, pendingHere(stopCommand)),
      archive: actionState(flags.archive, pendingHere(archiveCommand)),
      resolveConflicts: metadata.actions.resolveConflicts,
      chooseEngine: metadata.actions.chooseEngine,
    },
  })

  // What each intent reads when it is called: the render the user is looking at, never the one
  // the callbacks were created in.
  const latest = useRef({ run, data, options, continuation, titleEditor })
  latest.current = { run, data, options, continuation, titleEditor }
  const commands = useRef({ continueCommand, stopCommand, archiveCommand })
  commands.current = { continueCommand, stopCommand, archiveCommand }

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
      onResolveConflicts: (prNumberToResolve: number) => latest.current.options.metadata.intents.resolveConflicts?.(prNumberToResolve),
      onNavigate: (href: string) => latest.current.options.metadata.intents.navigate?.(href),
      onChooseEngine: () => latest.current.options.metadata.intents.chooseEngine?.(),
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
