import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleStopIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  MailIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { memo, useId, useReducer, useState } from 'react'
import { Link, useNavigate } from '@/lib/project-router'

import { ApiError, deleteRun, openRunIn, openRunInCli } from '@/api/client'
import {
  queryKeys,
  useMarkRunUnseen,
  useOpenTargets,
  usePinRun,
  useProviderStatus,
  useRunHandoff,
  useRuns,
} from '@/api/queries'
import type { ApiRun, OpenTarget } from '@open-mercato/cezar-api-client'
import { TaskHeaderMain, TaskMetadata, type TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'
import { ComponentHost, useHostedComponent } from '@/component-registry/component-host'
import { TitleEditInput } from '@/components/editable-title'
import { StatusDot } from '@/components/status-dot'
import { TabLink } from '@/components/tab-link'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { OpenInMenu, type OpenInChoice } from '@/components/open-in-menu'
import { toast } from '@/components/ui/toaster'
import { deriveAttention } from '@/lib/attention'
import { runTitle } from '@/lib/task-groups'
import { usableRunners } from '@/lib/provider-status'

import { Markdown } from './markdown'
import { cliTargetResumes, cliTargetRunner, finishTitle, resumeHint, runActionFlags } from './run-actions'
import { WorkflowSteps } from './step-rail'
import { useTaskHeaderModel } from './task-header-main'
import { useTaskMetadataController } from './task-metadata'
import { createTaskHeaderBinding, TaskLayoutRenderer, taskLayoutSubject } from './task-layout'
import type { TaskLayoutSnapshot } from '@/page-layout'
import { useFinishRun } from './use-finish-run'

/**
 * The run header (spec §"Task thread" → Header): editable title + status pill, the meta line,
 * the Session | Changes | Files tabs with the action bar, the workflow step rail and the plan
 * mirror — the whole header region above the thread. It scrolls away on phones so the transcript
 * owns the small viewport, and stays sticky from `md` upward where there is room for persistent
 * run context.
 *
 * It is core's SHELL (spec `.ai/specs/2026-09-19-task-header-contract.md`, § The split): the title
 * row and meta row are the replaceable `cezar.task.header.main@1`, rendered only through
 * `ComponentHost` from the props `useTaskHeaderModel` builds, and core's default for them is
 * `CoreTaskHeaderMain`. Everything that controls the task stays here, beside the part: the action
 * bar and the Run actions menu (whose Continue, Cancel and Archive draw from the same model and
 * call the same intents), the tabs, the monitoring and dispatch lines, the step rail, the resume
 * hint, the notes and the title editor. The one exception (spec Q3): an implementation that declares
 * `offers-continue`, `offers-stop` or `offers-archive` renders that action itself, so the bar leaves
 * it out, and the Run actions menu, which still lists every task action, stays visible at every width.
 *
 * Two deliberate omissions, both seams rather than gaps:
 *  - **VS Code** (spec: `POST /api/runs/:id/open-in-editor`) — the endpoint does not exist yet;
 *    R5 adds it driver-detected. Faking the button against nothing would be dishonest.
 *  - **Hosted mode** (spec §"Deployment modes"): when R5's `capabilities.localHandoff` lands in
 *    `/api/health`, Terminal (and VS Code) must disappear entirely and the resume hint must drop
 *    its `cd`. Today's HealthResponse carries no such field, so Terminal renders per current
 *    (local-only) behavior — the gate goes in where the flags are read, `runActionFlags` callers.
 */
/** Which run-detail tab this header instance sits above — drives the active underline.
 *  A prop rather than a route match so the header stays testable with a bare render. */
export type RunTab = 'session' | 'changes' | 'commits' | 'files'

interface RunHeaderProps {
  run: ApiRun
  planTally?: { done: number; total: number }
  tab?: RunTab
  /** Fired the moment "Mark unread" is invoked, BEFORE the mutation — the Session tab uses it
   *  to suppress its auto-mark-read effect for the rest of the visit (#775). Optional because
   *  the three `task-git` tabs render this same header and run no such effect. */
  onMarkedUnread?: () => void
  /** The Session tab's way to its engine picker for the next continuation: moves focus to the
   *  dock's first engine pill (spec 2026-09-19-task-header-contract, Q7). Kept out of the three Git
   *  tabs: they share this header but have no dock. A stable identity, like `onMarkedUnread`. */
  onChooseEngine?: () => void
  /** The schema-backed layout snapshot supplied by the Task Page route. */
  layout?: TaskLayoutSnapshot
}

// Every prop must participate: adding one without a comparator is a compile error.
const headerPropComparators = {
  run: (before, after) => before.run === after.run,
  tab: (before, after) => before.tab === after.tab,
  onMarkedUnread: (before, after) => before.onMarkedUnread === after.onMarkedUnread,
  onChooseEngine: (before, after) => before.onChooseEngine === after.onChooseEngine,
  layout: (before, after) => before.layout === after.layout,
  planTally: (before, after) => before.planTally?.done === after.planTally?.done &&
    before.planTally?.total === after.planTally?.total,
} satisfies Record<keyof RunHeaderProps, (before: RunHeaderProps, after: RunHeaderProps) => boolean>
const compareHeaderProps = Object.values(headerPropComparators)

export const RunHeader = memo(RunHeaderView, (before, after) =>
  compareHeaderProps.every((compare) => compare(before, after)),
)

const detailsOpenByTask = new Map<string, boolean>()

function RunHeaderView({
  run,
  planTally,
  tab = 'session',
  onMarkedUnread,
  onChooseEngine,
  layout,
}: RunHeaderProps) {
  const flags = runActionFlags(run)
  const hint = resumeHint(run)
  const [notesOpen, setNotesOpen] = useState(false)
  const [, bumpDetails] = useReducer((count: number) => count + 1, 0)
  const detailsId = useId()
  const actions = useRunActions(run, onMarkedUnread)
  const metadata = useTaskMetadataController(run, { chooseEngine: onChooseEngine })
  const detailsOpen = detailsOpenByTask.get(run.id) ?? false
  const toggleDetails = () => {
    detailsOpenByTask.set(run.id, !detailsOpen)
    bumpDetails()
  }
  // The one reader of the run behind the replaceable part and the three task actions it models.
  const model = useTaskHeaderModel(run, {
    planTally,
    requestStopConfirmation: () => actions.setConfirming('cancel'),
    metadata,
  })
  const { props } = model
  const editor = model.titleEditor
  // Which of Continue, Stop and Archive the implementation the host renders now takes over (spec
  // Q3). The host makes the same choice from the same failure record, so the two cannot disagree.
  const offered = offeredActions(useHostedComponent(
    TaskHeaderMain,
    layout === undefined ? run.id : taskLayoutSubject(layout, 'header', TaskHeaderMain.id),
  )?.capabilities)

  return (
    <header
      data-slot="run-header"
      className="relative z-20 border-b border-border bg-background/95 px-3 pt-2 backdrop-blur md:sticky md:top-0 md:px-6 md:pt-3"
    >
      <div className="mx-auto w-full max-w-[var(--measure)]">
        {/* The title, the status and the basic meta are `cezar.task.header.main@1`: rendered
            through the host, so an extension may replace them, with core's default one error
            boundary away. The Run actions menu sits beside the host, not inside it, so no
            replacement can take a task's controls away. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="relative min-w-0 flex-1">
            {/* Rename is core's, whatever renders the part: the editor covers the part's top
                30 px (the contract's `minBlockSize`) while the part stays mounted, hidden and
                inert, so the header keeps its height and a saved draft is never stranded. */}
            {editor.editing ? (
              <div data-slot="title-editor" className="absolute inset-x-0 top-0 z-10 flex h-[30px] items-center bg-background">
                <TitleEditInput editor={editor} className="flex-1 text-[15px] font-semibold" />
              </div>
            ) : null}
            <div data-slot="task-header-main" inert={editor.editing} className={editor.editing ? 'invisible' : undefined}>
              {layout === undefined ? (
                <ComponentHost contract={TaskHeaderMain} subject={run.id} props={props} />
              ) : (
                <TaskLayoutRenderer
                  snapshot={layout}
                  context={{ header: props }}
                  bindings={[createTaskHeaderBinding()]}
                  zones={['header']}
                />
              )}
            </div>
            <div
              id={detailsId}
              data-slot="run-details"
              className={detailsOpen ? 'mt-1 md:mt-1.5' : 'mt-1 hidden md:block md:mt-1.5'}
            >
              <ComponentHost contract={TaskMetadata} subject={run.id} props={metadata} />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="self-start md:hidden"
            aria-label={detailsOpen ? 'Hide run details' : 'Show run details'}
            aria-controls={detailsId}
            aria-expanded={detailsOpen}
            onClick={toggleDetails}
          >
            <ChevronDownIcon aria-hidden="true" className={detailsOpen ? 'rotate-180' : undefined} />
          </Button>
          <ActionsKebab
            run={run}
            actions={actions}
            header={props}
            // While the part offers any task action, the menu is how control stays available at
            // every width: it lists all of them, whatever the part renders.
            alwaysVisible={offered.any}
            onToggleNotes={() => setNotesOpen((open) => !open)}
          />
        </div>
        {/* Outside the part on purpose: "this run wakes itself up at 14:20" is status, not
            metadata — it belongs with the pill above, not behind a tap with the diff stats. And
            it stays core's, beside the part. */}
        <MonitoringSchedule run={run} />
        {/* Also outside it, for the same reason: who ordered this task, and what it dispatched,
            are what the run IS doing right now, not metadata about how it started. */}
        <DispatchParentLine run={run} />
        <DispatchChildrenLine run={run} />

        <div data-slot="run-tabs" className="mt-1.5 flex items-end gap-1 md:mt-2.5">
          <TabLink to={`/tasks/${run.id}`} active={tab === 'session'}>
            Session
          </TabLink>
          <TabLink to={`/tasks/${run.id}/changes`} active={tab === 'changes'}>
            Changes
          </TabLink>
          <TabLink to={`/tasks/${run.id}/commits`} active={tab === 'commits'}>
            Commits
          </TabLink>
          <TabLink to={`/tasks/${run.id}/files`} active={tab === 'files'}>
            Files
          </TabLink>

          <div data-slot="run-actions" className="ml-auto hidden items-center gap-1 pb-1 md:flex">
            {flags.finish ? (
              <Button variant="outline" size="sm" title={finishTitle(run.status)} onClick={() => actions.finish.mutate()}>
                <CheckIcon aria-hidden="true" />
                Finish
              </Button>
            ) : null}
            {props.actions.continue.available && !offered.continue ? (
              <Button
                variant="outline"
                size="sm"
                title={props.actions.continue.reason ?? 'Reopen the session'}
                disabled={!props.actions.continue.enabled}
                onClick={props.onContinue}
              >
                <PlayIcon aria-hidden="true" />
                Continue
              </Button>
            ) : null}
            {/* Terminal is folded into the Open in… menu to save room in the actions row. */}
            <OpenInMenuForRun run={run} canResume={flags.terminal} onResume={() => actions.terminal.mutate()} />
            <Button
              variant="ghost"
              size="sm"
              title="Handoff notes — what the agent did and what's left"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
            >
              <FileTextIcon aria-hidden="true" />
              Notes
            </Button>
            {flags.markUnread ? (
              <Button
                variant="ghost"
                size="sm"
                title="Put this task back in the unread list"
                disabled={actions.markUnread.isPending}
                onClick={() => actions.markUnread.mutate()}
              >
                <MailIcon aria-hidden="true" />
                Mark unread
              </Button>
            ) : null}
            {flags.pin ? (
              <Button
                variant="ghost"
                size="sm"
                data-slot="pin-run"
                aria-pressed={Boolean(run.pinned)}
                title={
                  run.pinned
                    ? 'Unpin from the top of this project’s task list'
                    : 'Pin to the top of this project’s task list'
                }
                disabled={actions.pin.isPending}
                onClick={() => actions.pin.mutate()}
              >
                {run.pinned ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />}
                {run.pinned ? 'Unpin' : 'Pin'}
              </Button>
            ) : null}
            {props.actions.archive.available && !offered.archive ? (
              <Button variant="ghost" size="sm" disabled={!props.actions.archive.enabled} onClick={props.onArchive}>
                {props.task.archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
                {props.task.archived ? 'Unarchive' : 'Archive'}
              </Button>
            ) : null}
            {props.actions.stop.available && !offered.stop ? (
              <Button variant="danger-ghost" size="sm" disabled={!props.actions.stop.enabled} onClick={props.onStop}>
                <CircleStopIcon aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
            {flags.deleteRun ? (
              <Button variant="danger-ghost" size="sm" onClick={() => actions.setConfirming('delete')}>
                <Trash2Icon aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>

        {run.steps.length > 0 ? (
          <div className="border-t border-border pt-1 pb-0 md:pt-2 md:pb-1">
            <WorkflowSteps runId={run.id} steps={run.steps} />
          </div>
        ) : null}

        {hint ? <ResumeHintLine hint={hint} /> : null}
        {notesOpen ? <NotesPanel runId={run.id} /> : null}
      </div>

      <ConfirmDialog run={run} actions={actions} stopTask={model.stopTask} />
    </header>
  )
}

/**
 * Which task actions the hosted implementation renders itself (spec
 * `2026-09-19-task-header-contract`, Q3): its CHECKED capabilities, as everywhere in the registry,
 * never the list it declared. Core's own default offers none, so the bar is today's bar.
 */
function offeredActions(capabilities: readonly string[] | undefined) {
  const offers = (capability: string) => capabilities?.includes(capability) === true
  const continueTask = offers('offers-continue')
  const stop = offers('offers-stop')
  const archive = offers('offers-archive')
  return { continue: continueTask, stop, archive, any: continueTask || stop || archive }
}

/**
 * "Open in…" session takeover (#open-in): resume the session in a real terminal, open the run's
 * worktree in a local editor / Finder / terminal / agent CLI, or copy its path.
 *
 * The menu itself is the shared `OpenInMenu` (components/open-in-menu.tsx); what lives here is
 * everything run-SPECIFIC — the resume item, which agent handoffs are currently usable, the
 * `(resume)` labelling, and the copy-path row. Renders when the session can be resumed OR the
 * machine offers worktree targets (both empty in hosted mode → nothing to show).
 */
function OpenInMenuForRun({
  run,
  canResume,
  onResume,
}: {
  run: ApiRun
  canResume: boolean
  onResume: () => void
}) {
  const targets = useOpenTargets()
  const providers = useProviderStatus()
  const open = useMutation({
    mutationFn: (target: string) => openRunIn(run.id, target),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const availableRunners = usableRunners(providers.data)
  // The action routes remain authoritative for a stale browser. Once the complete status has
  // arrived, hide only unavailable *agent* handoffs; editors, Finder, and file tools stay
  // available because they do not launch a provider.
  const agentAvailable = (runner: ApiRun['runner']) =>
    !providers.isSuccess || availableRunners.includes(runner ?? 'claude')
  const canResumeHere = canResume && agentAvailable(run.runner)
  const choices: OpenInChoice[] = run.worktreePath
    ? (targets.data?.targets ?? [])
        .filter((target) => {
          const runner = cliTargetRunner(target.id)
          return runner === undefined || agentAvailable(runner)
        })
        // Agent-CLI targets (#402): the one matching this run's own runner resumes THIS run's
        // session when one exists — label that explicitly so it reads as different from just
        // opening the editor/file-manager entries. Every other CLI (wrong backend, or no session
        // yet) still opens, just starts clean — no silent cross-backend resume attempt.
        .map((target) => {
          const resumes = cliTargetResumes(run, target.id)
          return {
            target,
            ...(resumes ? { suffix: ' (resume)', title: "Resume this run's session" } : {}),
          }
        })
    : []
  if (!canResumeHere && choices.length === 0) return null

  const copyPath = () => {
    const path = run.worktreePath
    if (!path) return
    void navigator.clipboard
      .writeText(path)
      .then(() => toast('Worktree path copied'))
      .catch(() => toast(`Path: ${path}`))
  }

  return (
    <OpenInMenu
      choices={choices}
      onPick={(target) => open.mutate(target)}
      title="Resume in a terminal, or open the worktree locally"
      leading={
        canResumeHere ? (
          <DropdownMenuItem data-target="terminal-resume" onSelect={onResume}>
            <SquareTerminalIcon aria-hidden="true" />
            Terminal (resume session)
          </DropdownMenuItem>
        ) : null
      }
      trailing={
        run.worktreePath ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copyPath}>
              <CopyIcon aria-hidden="true" />
              Copy worktree path
            </DropdownMenuItem>
          </>
        ) : null
      }
    />
  )
}

/** The shell's own mutations + confirm state, bundled so the desktop bar and the mobile kebab drive
 *  the exact same behavior. Continue, Cancel and Archive are the task header's model
 *  (`useTaskHeaderModel`); what stays here is Finish, Pin, Mark unread, Delete and Terminal, and the
 *  confirmation dialog both kinds share. Every failure surfaces the server's own words as a danger
 *  toast. */
function useRunActions(run: ApiRun, onMarkedUnread?: () => void) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState<'cancel' | 'delete' | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
  const showError = (error: Error) => toast(error.message, { tone: 'danger' })
  const onError = (error: Error) => {
    // Every 409 here says the same thing: the record these buttons were drawn from is not the run
    // the server has (Pin on a run that was just archived, Delete on one that is running again).
    // Refetch it, so the bar redraws to the truth instead of offering the same refused action —
    // the composer's rule (deliver-prompt.ts) and the thread's healer (run-reconcile.ts), applied
    // to the actions. `useSendMessage` in queries.ts has always done exactly this. The task
    // commands behind Continue, Cancel and Archive apply the same rule in their handlers
    // (commands/core-commands.ts).
    if (error instanceof ApiError && error.status === 409) void invalidate()
    showError(error)
  }

  // Shared with the review panel's ✓ Accept (use-finish-run.ts) — the review-accept semantics
  // must be ONE implementation, not two buttons that happen to agree today.
  const finish = useFinishRun(run.id)
  // Pin/unpin (#935) — the shared hook rather than a local mutation, because the sidebar and the
  // Tasks table drive the same action and the cache rule belongs in one place. Toggling off the
  // record, exactly like archive.
  const pinMutation = usePinRun()
  const pin = {
    isPending: pinMutation.isPending,
    mutate: () => pinMutation.mutate({ id: run.id, pinned: !run.pinned }, { onError }),
  }
  // Mark unread (#775) drives the shared optimistic hook rather than a local mutation: the
  // cache choreography (clear `seenAt`, guarded rollback) belongs next to its read twin in
  // queries.ts, and no `invalidate` is wanted here — an invalidation would refetch the list
  // and reinstate the receipt before the server's own answer lands.
  const markUnreadMutation = useMarkRunUnseen()
  const markUnread = {
    isPending: markUnreadMutation.isPending,
    mutate: () => {
      // Before the mutation, so the Session tab's suppression is in place by the time the
      // optimistic write re-renders the thread and re-evaluates its auto-mark-read effect.
      onMarkedUnread?.()
      markUnreadMutation.mutate(run.id, { onError })
    },
  }
  const deleteMutation = useMutation({
    mutationFn: () => deleteRun(run.id),
    onSuccess: () => {
      invalidate()
      // The run is gone — so is this page. Home is the only honest destination.
      void navigate('/')
    },
    onError,
  })
  const terminal = useMutation({
    mutationFn: () => openRunInCli(run.id),
    onError: (error: Error) => {
      // The legacy 409 fallback: no terminal emulator → the server sends the manual command;
      // put it on the clipboard so "no terminal" still ends with the user one paste away.
      if (error instanceof ApiError && error.command) {
        void copyToClipboard(error.command, 'No terminal found — command copied to clipboard.')
        return
      }
      onError(error)
    },
  })

  return {
    finish,
    pin,
    markUnread,
    delete: deleteMutation,
    terminal,
    confirming,
    setConfirming,
  }
}

type RunActions = ReturnType<typeof useRunActions>

async function copyToClipboard(text: string, doneMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(doneMessage)
  } catch {
    // No clipboard access (permissions, http) — show the command itself; it is the payload.
    toast(`Run manually: ${text}`)
  }
}

/**
 * "Dispatched by <parent>" — one row linking a dispatched task back to the task that ordered it
 * (spec `.ai/specs/2026-09-10-dispatch.md`).
 *
 * Provenance, so it renders whether or not `capabilities.dispatch` is still on: a run created by
 * a dispatch keeps its `dispatch.parentRunId` forever, and hiding the line on a server that later
 * turned the flag off would leave a thread that cannot explain who ordered it. The parent's TITLE
 * comes from the run list this page already holds; a parent outside that list (another project,
 * or pruned) still gets its link, labelled by its id.
 */
function DispatchParentLine({ run }: { run: ApiRun }) {
  const runs = useRuns()
  const parentRunId = run.dispatch?.parentRunId
  if (parentRunId === undefined) return null
  const parent = (runs.data ?? []).find((candidate) => candidate.id === parentRunId)
  const attention = parent ? deriveAttention(parent) : null
  return (
    <div
      data-slot="dispatch-parent-line"
      className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground"
    >
      <span className="shrink-0">Dispatched by</span>
      <Link
        to={`/tasks/${parentRunId}`}
        data-slot="dispatch-parent"
        data-run-id={parentRunId}
        className="inline-flex min-w-0 items-center gap-1.5 truncate hover:text-foreground"
      >
        {attention ? <StatusDot tone={attention.tone} pulse={attention.pulse} /> : null}
        <span className="truncate">{parent ? runTitle(parent) : parentRunId}</span>
      </Link>
    </div>
  )
}

/**
 * "Subtasks: <child> · <child> …" — one collapsed row naming the tasks this one dispatched.
 *
 * Derived from the run list this page already holds rather than fetched: a child's link is its
 * id and its dot is its status, both of which `useRuns()` carries and keeps live over the run
 * stream. Nothing renders for a run that dispatched nothing — which is every run on a server
 * that never turned dispatch on.
 *
 * Deliberately ONE row, truncated: the full tree is the task list, and a header that grew a list
 * would push the transcript off the screen exactly when a parent has the most children.
 */
function DispatchChildrenLine({ run }: { run: ApiRun }) {
  const runs = useRuns()
  const children = (runs.data ?? []).filter(
    (candidate) => candidate.dispatch?.parentRunId === run.id,
  )
  if (children.length === 0) return null
  return (
    <div
      data-slot="dispatch-children"
      className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground"
    >
      <span className="shrink-0">Subtasks</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-hidden">
        {children.map((child) => {
          const attention = deriveAttention(child)
          return (
            <Link
              key={child.id}
              to={`/tasks/${child.id}`}
              data-slot="dispatch-child"
              data-run-id={child.id}
              title={`${runTitle(child)} — ${attention.label}`}
              className="inline-flex max-w-52 items-center gap-1.5 truncate hover:text-foreground"
            >
              <StatusDot tone={attention.tone} pulse={attention.pulse} />
              <span className="truncate">{runTitle(child)}</span>
            </Link>
          )
        })}
      </span>
    </div>
  )
}

function MonitoringSchedule({ run }: { run: ApiRun }) {
  if (run.status !== 'running' || run.activity !== 'monitoring') return null
  if (run.monitoringWakeCapReached) {
    return (
      <p data-slot="monitoring-schedule" role="status" className="mt-1 text-xs text-muted-foreground">
        Automatic checks paused — 40/40 reached
      </p>
    )
  }
  const wakeAt = run.monitoringWakeAt ? new Date(run.monitoringWakeAt) : null
  const validWakeAt = wakeAt && Number.isFinite(wakeAt.getTime()) ? wakeAt : null
  if (!validWakeAt) {
    return (
      <p data-slot="monitoring-schedule" role="status" className="mt-1 text-xs text-muted-foreground">
        Parked — no automatic check scheduled
      </p>
    )
  }
  const label = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(validWakeAt)
  return (
    <p data-slot="monitoring-schedule" role="status" className="mt-1 text-xs text-muted-foreground">
      Next automatic check{' '}
      <time dateTime={run.monitoringWakeAt} className="font-medium text-foreground">
        {label}
      </time>
    </p>
  )
}

/** The <md action surface: everything the desktop bar offers, folded into a kebab menu next to
 *  the part (the mockup's mobile pattern — `.tabs-row .actions { display:none }` under 768px).
 *  Continue, Cancel and Archive draw from the header's model and call its intents, like the bar. */
function ActionsKebab({
  run,
  actions,
  header,
  alwaysVisible,
  onToggleNotes,
}: {
  run: ApiRun
  actions: RunActions
  header: TaskHeaderMainProps
  /** The part offers a task action itself: the menu stays at every width, not only below `md`. */
  alwaysVisible: boolean
  onToggleNotes: () => void
}) {
  const flags = runActionFlags(run)
  const task = header.actions
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Run actions" className={alwaysVisible ? undefined : 'md:hidden'}>
          <EllipsisVerticalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-slot="run-actions-menu">
        {flags.finish ? (
          <DropdownMenuItem onSelect={() => actions.finish.mutate()}>
            <CheckIcon aria-hidden="true" /> Finish
          </DropdownMenuItem>
        ) : null}
        {task.continue.available ? (
          <DropdownMenuItem disabled={!task.continue.enabled} title={task.continue.reason} onSelect={header.onContinue}>
            <PlayIcon aria-hidden="true" /> Continue
          </DropdownMenuItem>
        ) : null}
        {flags.terminal ? (
          <DropdownMenuItem onSelect={() => actions.terminal.mutate()}>
            <SquareTerminalIcon aria-hidden="true" /> Terminal
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onToggleNotes}>
          <FileTextIcon aria-hidden="true" /> Notes
        </DropdownMenuItem>
        {flags.markUnread ? (
          <DropdownMenuItem
            disabled={actions.markUnread.isPending}
            onSelect={() => actions.markUnread.mutate()}
          >
            <MailIcon aria-hidden="true" /> Mark unread
          </DropdownMenuItem>
        ) : null}
        {flags.pin ? (
          <DropdownMenuItem
            data-slot="pin-run"
            // The same `aria-pressed` its desktop twin and `PinToggle` carry — a toggle should
            // announce its state in every spelling, not only the ones with room for the word.
            aria-pressed={Boolean(run.pinned)}
            disabled={actions.pin.isPending}
            onSelect={() => actions.pin.mutate()}
          >
            {run.pinned ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />}
            {run.pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        ) : null}
        {task.archive.available ? (
          <DropdownMenuItem disabled={!task.archive.enabled} onSelect={header.onArchive}>
            {header.task.archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
            {header.task.archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
        ) : null}
        {task.stop.available || flags.deleteRun ? <DropdownMenuSeparator /> : null}
        {task.stop.available ? (
          <DropdownMenuItem variant="destructive" disabled={!task.stop.enabled} onSelect={header.onStop}>
            <CircleStopIcon aria-hidden="true" /> Cancel
          </DropdownMenuItem>
        ) : null}
        {flags.deleteRun ? (
          <DropdownMenuItem variant="destructive" onSelect={() => actions.setConfirming('delete')}>
            <Trash2Icon aria-hidden="true" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The destructive confirms — one dialog, two scripts. Never a native confirm(). */
function ConfirmDialog({ run, actions, stopTask }: { run: ApiRun; actions: RunActions; stopTask: () => void }) {
  const confirming = actions.confirming
  return (
    <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && actions.setConfirming(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirming === 'delete' ? 'Delete this task?' : 'Cancel this task?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirming === 'delete' ? (
              <>
                This removes the run, its transcript, its worktree and its branch. There is no
                undo.
                <span className="mt-1 block truncate font-medium text-foreground" title={runTitle(run)}>
                  {runTitle(run)}
                </span>
              </>
            ) : (
              'The agent is stopped and the run completes as cancelled. The worktree stays.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-danger-foreground hover:brightness-[0.96]"
            onClick={() => {
              // The stop itself: `onStop`, from the bar, the menu or any implementation of the
              // part, only ever asks for this confirmation.
              if (confirming === 'delete') actions.delete.mutate()
              else stopTask()
              actions.setConfirming(null)
            }}
          >
            {confirming === 'delete' ? 'Delete' : 'Cancel the run'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** "take over interactively: cd … && claude --resume …" — the legacy `#d-resume` line, now
 *  copyable. Local-machine phrasing; hosted mode (R5, `capabilities.localHandoff`) will swap the
 *  cd-prefix for a bare resume command. */
function ResumeHintLine({ hint }: { hint: string }) {
  return (
    <button
      type="button"
      data-slot="resume-hint"
      title="Copy the command"
      onClick={() => void copyToClipboard(hint, 'Command copied to clipboard.')}
      className="mb-2 flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left font-mono text-[11px] text-soft-foreground hover:bg-muted hover:text-foreground"
    >
      <CopyIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">take over interactively: {hint}</span>
    </button>
  )
}

/** The handoff journal (spec 007) as rendered markdown — fetched only while open. */
function NotesPanel({ runId }: { runId: string }) {
  const handoff = useRunHandoff(runId)
  return (
    <div
      data-slot="notes-panel"
      className="mb-3 max-h-72 overflow-y-auto rounded-md border border-border bg-card px-4 py-3"
    >
      {handoff.isPending ? (
        <p className="text-xs text-soft-foreground">Loading notes…</p>
      ) : handoff.isError ? (
        <p className="text-xs text-danger">{handoff.error.message}</p>
      ) : handoff.data.trim().length > 0 ? (
        <Markdown>{handoff.data}</Markdown>
      ) : (
        <p className="text-xs text-soft-foreground">
          No notes yet — the handoff file is seeded when the task starts.
        </p>
      )}
    </div>
  )
}
