import { BotIcon, ChevronDownIcon, PencilIcon } from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useReducer, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Link } from '@/lib/project-router'

import {
  useAgentProfiles,
  useConfig,
  useHealth,
  usePatchRun,
  useProjectRepoBase,
  useReferenceProjectId,
  useRuns,
} from '@/api/queries'
import { DEFAULT_AGENT_ACCOUNT_ID, type ApiRun } from '@open-mercato/cezar-api-client'
import type { TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'
import { DiffStatLabel } from '@/components/diff-stat'
import { TitleEditInput, useTitleEditor, type TitleEditor } from '@/components/editable-title'
import { Pill } from '@/components/pill'
import { ReferenceChip } from '@/components/reference-chip'
import { ResolveConflictsButton } from '@/components/reference-conflict-action'
import { ReferenceStatusProvider } from '@/components/reference-status'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toaster'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DirectionalUsage } from '@/components/directional-usage'
import { deriveAttention } from '@/lib/attention'
import { queuePositions, runTitle } from '@/lib/task-groups'
import {
  formatCost,
  prNumber,
  taskIssueUrl,
  taskPrUrl,
  taskReferences,
  workflowLabel,
} from '@/lib/tasks-table'
import { usageMetricVisibility } from '@/lib/token-metrics'
import { cn, isHttpUrl } from '@/lib/utils'

import { useTaskHeaderCore } from './task-header-main'
import { useDraft } from './thread-draft'

/**
 * Core's default for `cezar.task.header.main@1` (spec `.ai/specs/2026-09-19-component-host.md`):
 * the task header's title row and meta row, moved unchanged from `run-header.tsx`. `RunHeader`
 * renders it only through `ComponentHost`, and `component-registry/core-components.ts` is the one
 * module that imports it (`component-registry/boundary.test.ts`).
 *
 * It reads the page's run and the engine picker from the shell's core-only context, and `plan`
 * from the contract's props, so it renders exactly what the header rendered before the split. It
 * throws outside `RunHeader`.
 */

/** Which runs the reader has expanded the phone-width meta row for (#765). A module-level map for
 *  the same reason `WorkflowSteps` keeps one (`openByRun` in step-rail.tsx) — and it has to be BOTH
 *  module-level and run-keyed, because the two navigations a reader makes here remount the header
 *  in opposite ways. A Session → Changes hop resolves a different route element, so it DOES remount
 *  and plain `useState` would throw the expand away; run A → run B stays on `/tasks/:id`, so React
 *  reconciles the same element and does NOT remount — the docks below it key themselves by `run.id`
 *  for exactly this reason — so even lazily-initialized `useState` would carry run A's expansion
 *  into run B. Session-lifetime only; no server persistence invented for it. */
const detailsOpenByRun = new Map<string, boolean>()

export function CoreTaskHeaderMain({ plan }: TaskHeaderMainProps): ReactElement {
  const { run, continuationEngine } = useTaskHeaderCore()
  const attention = deriveAttention(run)

  // The phone-width meta disclosure (#765). The map is the state — a re-render bump rather than a
  // mirrored `useState` — so switching runs reads that run's own answer instead of the last one's.
  const [, bumpDetails] = useReducer((n: number) => n + 1, 0)
  const detailsId = useId()
  const detailsOpen = detailsOpenByRun.get(run.id) ?? false
  const toggleDetails = () => {
    detailsOpenByRun.set(run.id, !detailsOpen)
    bumpDetails()
  }

  // The queue position a parked run shows in its pill ("queued #2"). Reads the shared runs-list
  // query — already warm from the sidebar quick-list — because position is a property of the
  // whole queue, not of this record.
  const queuePosition = useRuns(
    useMemo(
      () => (runs: ApiRun[]) =>
        run.status === 'queued' ? queuePositions(runs).get(run.id) : undefined,
      [run.id, run.status],
    ),
  ).data
  const health = useHealth()
  const metricVisibility = usageMetricVisibility(health.data)

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <EditableTitle run={run} />
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {plan ? (
            // The plan dock's compact mirror (spec: "mirrored as a compact progress line in
            // the run header"). Desktop only since #764: on a phone the dock it mirrors is
            // itself on screen, so the mirror would spend the tightest row here restating it.
            <span data-slot="plan-mirror" className="hidden text-[11px] text-soft-foreground tabular-nums md:inline">
              Plan {plan.done}/{plan.total}
            </span>
          ) : null}
          <Pill dot={attention.tone} pulse={attention.pulse}>
            {attention.label}
            {queuePosition !== undefined ? ` #${queuePosition}` : ''}
          </Pill>
          {/* Phone-width only: above `md` the meta row never collapses, so a control to expand
              it would be a permanently disabled-looking chevron next to always-visible content.
              On the Session tab of a run with a plan it lands in the slot #764 freed by hiding
              the plan mirror here; on the three `task-git` tabs no tally is passed at all, so
              there the row does grow by one control — the price of the collapse. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label={detailsOpen ? 'Hide run details' : 'Show run details'}
            aria-controls={detailsId}
            aria-expanded={detailsOpen}
            onClick={toggleDetails}
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn('transition-transform', detailsOpen && 'rotate-180')}
            />
          </Button>
        </span>
      </div>

      {/* #765: workflow, branch, tracker refs, diff, tokens and cost wrap across several rows on
          a phone. `hidden` rather than a visual-only class so the collapsed rows leave the
          accessibility tree instead of lingering as invisible-but-focusable chips. `md:block`
          keeps the desktop header exactly as it was — this is a narrow-viewport fix, and a
          desktop reader who has always seen these at a glance should not have to click for them. */}
      <div id={detailsId} data-slot="run-details" className={cn(detailsOpen ? 'block' : 'hidden', 'md:block')}>
        <MetaRow
          run={run}
          continuationEngine={continuationEngine}
          showTokens={metricVisibility.tokens}
          showCost={metricVisibility.cost}
          // `capabilities?.` like `usageMetricVisibility` above it: this header is rendered
          // against minimal health payloads (a `{defaultRunner}`-only answer is pinned by its
          // own test), so every capability read here tolerates an absent object. Absent stays
          // fail-closed — the chip degrades to text rather than linking into a disabled view.
          automationsAvailable={health.data?.capabilities?.automations === true}
        />
      </div>
    </>
  )
}

/**
 * The editable title (#389): a plain h1 with a pencil that only appears on hover (mockup
 * `.pencil-btn`), flipping into an inline input. Enter/blur commit through `usePatchRun`
 * (the server stores it as both `title` and `titleSummary`), Escape abandons the draft.
 * The rename machine itself is shared with the Tasks table (`components/editable-title.tsx`).
 */
function EditableTitle({ run }: { run: ApiRun }) {
  const patch = usePatchRun(run.id)
  const title = runTitle(run)
  const draft = useDraft(run.id, 'title')
  const editor = useTitleEditor(title, (next) =>
    patch.mutate({ title: next }, { onError: (error) => toast(error.message, { tone: 'danger' }) }),
  )
  const drafted: TitleEditor = {
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

  const begin = useRef(editor.beginWith)
  begin.current = editor.beginWith
  const editing = editor.editing
  useEffect(() => {
    if (editing || !draft.ready || !draft.hasDraft) return
    begin.current(draft.text)
  }, [draft.hasDraft, draft.ready, draft.text, editing])

  if (editor.editing) {
    return <TitleEditInput editor={drafted} className="flex-1 text-[15px] font-semibold" />
  }

  return (
    <span className="group flex min-w-0 items-center gap-1">
      <h1 className="min-w-0 truncate text-[15px] font-semibold" title={run.task}>
        {title}
      </h1>
      <button
        type="button"
        aria-label="Rename task"
        onClick={editor.begin}
        className="shrink-0 rounded-sm p-1 text-soft-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <PencilIcon className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}

/** Copyable task branch with confirmation kept local so hovering it does not re-render MetaRow. */
function CopyBranchChip({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
    },
    [],
  )

  const copy = () => {
    if (!navigator.clipboard) {
      toast(`Branch: ${branch}`)
      return
    }
    void navigator.clipboard
      .writeText(branch)
      .then(() => {
        setCopied(true)
        setTooltipOpen(true)
        if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
        dismissTimer.current = setTimeout(() => {
          dismissTimer.current = null
          setTooltipOpen(false)
        }, 1_500)
      })
      .catch(() => toast(`Branch: ${branch}`))
  }

  return (
    <TooltipProvider>
      <Tooltip
          open={tooltipOpen}
          onOpenChange={(open) => {
            if (open && dismissTimer.current === null) setCopied(false)
            setTooltipOpen(open)
          }}
        >
          <TooltipTrigger asChild>
            <button
              type="button"
              data-slot="branch-chip"
              className="cursor-copy rounded-sm border border-border bg-card px-1.5 py-px font-mono text-[11px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={`Copy branch name ${branch}`}
              onClick={copy}
            >
              {branch}
              <span className="sr-only" role="status">
                {copied ? 'Branch name copied' : ''}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy branch name'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** workflow · branch chip · ± on the left; tokens · cost · agent icon on the right (mockup
 *  `.meta-row`, #416). Each part renders only when the record carries it — absence is absence,
 *  not a placeholder. Runner and model no longer sit in the loose dot-list (#416): they read as
 *  a status for the *active* session, so they move into the agent badge next to the token
 *  count, revealed on hover/focus rather than always-on text. */
function MetaRow({
  run,
  showTokens,
  showCost,
  automationsAvailable,
  continuationEngine,
}: {
  run: ApiRun
  showTokens: boolean
  showCost: boolean
  continuationEngine?: ReactNode
  /** `capabilities.automations` (#801). A run launched while automations were on keeps its
   *  `run.automation` provenance forever, so the chip must survive the flag going off — as
   *  plain text, because the route it used to link to is disabled. */
  automationsAvailable: boolean
}) {
  // #526: the issue chip may be synthesized from the CEZ:ISSUE marker, and the only repository
  // such a link may name is the one on screen — never the transcript's.
  const repoBase = useProjectRepoBase()
  // At most two references here, so this is a batch of one or two rather than of a table — but it
  // goes through the same seam, which is what keeps the header's chip and the table's chip
  // answering identically for the same PR.
  const projectId = useReferenceProjectId()
  const references = useMemo(() => taskReferences(run, repoBase), [run, repoBase])
  const referenceRequests = useMemo(
    () =>
      projectId === undefined
        ? []
        : references.map((reference) => ({
            projectId,
            kind: reference.kind,
            number: reference.number,
          })),
    [references, projectId],
  )
  // `workflowLabel` so an inline chain shows its first step's name, not the bare "(planned)"
  // placeholder — which reads like a status next to the live status pill.
  const parts: ReactNode[] = [<span key="workflow">{workflowLabel(run)}</span>]
  const branch = run.branch
  if (branch) {
    parts.push(<CopyBranchChip key="branch" branch={branch} />)
  }
  // EVERY PR the task points at, in `taskReferences` order — the same order, and the same
  // statuses, the global Tasks table paints. A task opened on someone else's PR that pushes a
  // follow-up of its own is about both, and its own page is the last place that should have to
  // pick one.
  //
  // A reference with no URL still gets its chip, exactly as All tasks paints it: a number-only
  // reference is what a `CEZ:PR` declaration looks like before any link is scraped, and the two
  // pages read their repository from DIFFERENT places (this one from health's remote, All tasks
  // from the project registry's `repoUrl`) — so "no URL here" never means "nothing to show".
  // `ReferenceChip` degrades such a chip to inert text on its own.
  const prReferences = references.filter((reference) => reference.kind === 'PR')
  for (const reference of prReferences) {
    parts.push(
      <ReferenceChip
        key={`pr-${reference.number}`}
        reference={reference}
        taskTitle={runTitle(run)}
        className="h-5"
        // Shown only on a chip that IS conflicting — the chip decides that, being the thing that
        // knows — and mounted only while its panel is open. The same component the Tasks table
        // hands its chips, so both send the same prompt on the same seam.
        conflictAction={<ResolveConflictsButton run={run} prNumber={reference.number} />}
      />,
    )
  }
  // The one PR chip `taskReferences` cannot express: a forge URL whose last segment is not a
  // number (`taskPrUrl`'s own tolerance — an unrecognized forge still gets a working link, just
  // without a number cezar would be inventing). Gated on that URL not being painted already,
  // NOT on there being no chips at all: today every `pullRequestUrl` is a GitHub `…/pull/N` and
  // the two are the same test, but a forge whose PR URLs do not end in a number (#847's GitLab
  // adapter) would have a `prNumber` chip standing in front of a link that then never rendered.
  const prUrl = taskPrUrl(run)
  if (prUrl && isHttpUrl(prUrl) && !prReferences.some((reference) => reference.url === prUrl)) {
    parts.push(
      <ReferenceChip
        key="pr"
        reference={{ kind: 'PR', url: prUrl }}
        taskTitle={runTitle(run)}
        className="h-5"
      />,
    )
  }
  const issueUrl = taskIssueUrl(run, repoBase)
  if (issueUrl && isHttpUrl(issueUrl)) {
    const number = prNumber(issueUrl)
    parts.push(
      <ReferenceChip
        key="issue"
        reference={{ kind: 'Issue', ...(number ? { number: Number(number) } : {}), url: issueUrl }}
        taskTitle={runTitle(run)}
        className="h-5"
      />,
    )
  }
  if (run.diffStat) parts.push(<DiffStatLabel key="diff" stat={run.diffStat} />)
  if (run.automation) {
    // Provenance is history and is always shown; only the LINK is gated. Following it with the
    // capability off would land on the disabled `/automations` state, which says nothing about
    // this task.
    parts.push(
      automationsAvailable ? (
        <Link
          key="automation"
          to={`/automations/${encodeURIComponent(run.automation.automationId)}/log`}
          className="rounded-sm border border-border bg-card px-1.5 py-px text-[11px] font-medium hover:text-foreground"
        >
          Automation
        </Link>
      ) : (
        <span
          key="automation"
          data-slot="automation-origin"
          title="Automations are off on this server (CEZ_AUTOMATIONS)"
          className="rounded-sm border border-border bg-card px-1.5 py-px text-[11px] font-medium"
        >
          Automation
        </span>
      ),
    )
  }

  const usage: ReactNode[] = []
  if (showTokens && (run.inputTokens !== undefined || run.outputTokens !== undefined)) {
    usage.push(
      <DirectionalUsage
        key="tokens"
        inputTokens={run.inputTokens}
        outputTokens={run.outputTokens}
      />,
    )
  }
  if (showCost && run.costUsd) {
    usage.push(
      <span key="cost" className="tabular-nums">
        {formatCost(run.costUsd)}
      </span>,
    )
  }

  return (
    <ReferenceStatusProvider projectId={projectId} requests={referenceRequests}>
      <div
        data-slot="run-meta"
        className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground md:mt-1.5 md:gap-y-1"
      >
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <span className="text-soft-foreground" aria-hidden="true">
                ·
              </span>
            ) : null}
            {part}
          </Fragment>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {usage.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? (
                <span className="text-soft-foreground" aria-hidden="true">
                  ·
                </span>
              ) : null}
              {part}
            </Fragment>
          ))}
          <AgentBadge run={run} continuationEngine={continuationEngine} />
        </span>
      </div>
    </ReferenceStatusProvider>
  )
}

/** The agent icon by the token counter (#416): hover/focus reveals the runner, account, model and
 *  canonical model identity — the answer to "what am I actually running here?" — without turning
 *  them into permanent text next to the live status pill. Always rendered (a run always has an
 *  effective runner, `model` reads "auto" when the runner picks it), and reuses the same
 *  click/keyboard-accessible `DropdownMenu` as the rest of this header instead of inventing a
 *  hover-only affordance.
 *
 *  This is the production reader for `RunRecord.modelIdentity` (#546): the field was persisted by
 *  #405 for cost attribution and replay and had none, which is how a persisted field rots into
 *  something nobody can tell is load-bearing. The menu is the right home for it — it answers a
 *  question only a user debugging "which provider actually served this?" asks, so it belongs
 *  behind the same disclosure as the account rather than in the truncating summary line. */
function AgentBadge({ run, continuationEngine }: { run: ApiRun; continuationEngine?: ReactNode }) {
  // The record keeps only what the caller ASKED for: `POST /api/runs` persists the raw optional
  // `runner` (`src/runs/store.ts`), while the run actually executes as
  // `input.runner ?? config.defaultRunner` (`src/workflows/run.ts`). Mirror that resolution —
  // hardcoding 'claude' would name the wrong agent on a repo whose `defaultRunner` is
  // codex/opencode, and "which agent produced this?" is the one question #416 exists to answer.
  // 'claude' stays the last resort only while the active project's config is in flight.
  // `/api/health` describes the boot project and can name the wrong runner on scoped routes.
  const config = useConfig()
  const profiles = useAgentProfiles()
  const runner = run.runner ?? config.data?.defaultRunner ?? 'claude'
  const model = run.model ?? 'auto'
  // The account is read from the STEP that actually spawned, never from the run's composer
  // override or the project's current selection (spec 2026-07-29-agent-profiles): the override is
  // absent whenever the run just followed the project, and the project's selection can have been
  // changed since — both would name an account this run may never have touched. The last step that
  // recorded one is what ran; `sessionId` and `profileId` are a pair for exactly this reason.
  const accountId = [...run.steps].reverse().find((step) => step.profileId)?.profileId
  const account = accountId === undefined
    ? undefined
    : accountId === DEFAULT_AGENT_ACCOUNT_ID
      ? 'default'
      // A deleted account still names the folder this run's sessions live in, so the id is shown
      // rather than swallowed — "gone" is the useful half of that answer.
      : profiles.data?.profiles.find((p) => p.id === accountId)?.label ?? `${accountId} (removed)`
  // The canonical `provider/model` the run actually resolved to (#405), shown only when it says
  // something `model` does not (#546). `model` is the free-text the caller ASKED for — `opus`,
  // `auto`, a gateway id — so on a repo whose Claude runner points at a custom endpoint the two
  // genuinely differ, and "which provider served this?" is a question only this field answers.
  // Absent on pre-#405 records and skipped when it merely repeats `model`, following the same
  // omitted-not-guessed rule as the account line below: an identity nothing wrote down is not
  // one this header may invent.
  const identity = run.modelIdentity && run.modelIdentity !== model ? run.modelIdentity : undefined
  const summary = [runner, account, model].filter(Boolean).join(' · ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="agent-badge"
          title={summary}
          aria-label={`Agent: ${runner}, ${account ? `account ${account}, ` : ''}model ${model}`}
          className="flex min-w-0 shrink items-center gap-1.5 rounded-sm px-1 py-1 text-soft-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {/* READ, not just reachable. This was an icon alone, and "which agent, account and model
              produced this?" turned out to be unanswerable without knowing to click it — the whole
              point of the badge. #416 moved runner/model out of the loose dot-list to cut noise;
              this puts them back as ONE quiet, truncating string rather than three chips, and the
              menu still carries the labelled breakdown. */}
          <span data-slot="agent-badge-summary" className="truncate font-mono text-[11px]">
            {summary}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">
          runner: {runner}
        </DropdownMenuLabel>
        {/* Omitted, not guessed, when no step recorded one: a run from before accounts existed
            cannot be said to have used the discovered account — nothing wrote that down. */}
        {account ? (
          <DropdownMenuLabel
            data-slot="agent-badge-account"
            className="font-mono text-[11px] font-normal text-muted-foreground"
          >
            account: {account}
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">
          model: {model}
        </DropdownMenuLabel>
        {identity ? (
          <DropdownMenuLabel
            data-slot="agent-badge-identity"
            className="font-mono text-[11px] font-normal text-muted-foreground"
          >
            identity: {identity}
          </DropdownMenuLabel>
        ) : null}
        {continuationEngine ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pb-1 text-[11px] font-normal text-muted-foreground">
              Next continuation
            </DropdownMenuLabel>
            <div
              data-slot="agent-badge-engine-picker"
              className="px-2 pb-1"
              // The controls open their own selection menus. Do not let a click inside this
              // custom menu row dismiss the parent badge before the nested picker can open.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {continuationEngine}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
