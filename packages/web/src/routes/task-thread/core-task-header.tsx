import { BotIcon, ChevronDownIcon, PencilIcon } from 'lucide-react'
import { Fragment, useEffect, useId, useReducer, useRef, useState, type ReactElement, type ReactNode } from 'react'

import type {
  TaskHeaderActionState,
  TaskHeaderEngine,
  TaskHeaderProps,
  TaskHeaderReference,
} from '@open-mercato/cezar-extension-api'
import { DiffStatLabel } from '@/components/diff-stat'
import { DirectionalUsage } from '@/components/directional-usage'
import { Pill } from '@/components/pill'
import { ReferenceChip, useCloseReferenceCard } from '@/components/reference-chip'
import type { StatusDotTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toaster'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCost } from '@/lib/tasks-table'
import { cn } from '@/lib/utils'

/**
 * Core's default for `task.header@1` (spec `.ai/specs/2026-09-19-task-header-contract.md`):
 * the task header's title row and meta row, rendered from the contract's props ALONE. It reads no
 * run record, query, router, command or core-only context — only core's presentational UI kit —
 * so an extension's header gets exactly what core's own header gets. `RunHeader` renders it only
 * through `ComponentHost`, and `component-registry/core-components.ts` is the one module that
 * imports it (`component-registry/boundary.test.ts`, `core-task-header-boundary.test.ts`).
 */

/** Which tasks the reader has expanded the phone-width meta row for (#765). A module-level map for
 *  the same reason `WorkflowSteps` keeps one (`openByRun` in step-rail.tsx) — and it has to be BOTH
 *  module-level and task-keyed, because the two navigations a reader makes here remount the header
 *  in opposite ways. A Session → Changes hop resolves a different route element, so it DOES remount
 *  and plain `useState` would throw the expand away; task A → task B stays on `/tasks/:id`, so React
 *  reconciles the same element and does NOT remount, so even lazily-initialized `useState` would
 *  carry task A's expansion into task B. Session-lifetime only; no server persistence invented for it. */
const detailsOpenByTask = new Map<string, boolean>()

const TONES: ReadonlySet<string> = new Set<StatusDotTone>(['success', 'pending', 'danger', 'violet', 'neutral'])

/** A tone this bundle does not know reads as neutral: the set may grow. */
function toneOf(tone: string): StatusDotTone {
  return TONES.has(tone) ? (tone as StatusDotTone) : 'neutral'
}

export function CoreTaskHeader(props: TaskHeaderProps): ReactElement {
  const { task, attention, plan } = props

  // The phone-width meta disclosure (#765). The map is the state — a re-render bump rather than a
  // mirrored `useState` — so switching tasks reads that task's own answer instead of the last one's.
  const [, bumpDetails] = useReducer((n: number) => n + 1, 0)
  const detailsId = useId()
  const detailsOpen = detailsOpenByTask.get(task.taskId) ?? false
  const toggleDetails = () => {
    detailsOpenByTask.set(task.taskId, !detailsOpen)
    bumpDetails()
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="group flex min-w-0 items-center gap-1">
          <h1 className="min-w-0 truncate text-[15px] font-semibold" title={task.prompt}>
            {task.title}
          </h1>
          <button
            type="button"
            aria-label="Rename task"
            onClick={props.onRename}
            className="shrink-0 rounded-sm p-1 text-soft-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
          </button>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {plan ? (
            // The plan dock's compact mirror (spec: "mirrored as a compact progress line in
            // the run header"). Desktop only since #764: on a phone the dock it mirrors is
            // itself on screen, so the mirror would spend the tightest row here restating it.
            <span data-slot="plan-mirror" className="hidden text-[11px] text-soft-foreground tabular-nums md:inline">
              Plan {plan.done}/{plan.total}
            </span>
          ) : null}
          <Pill dot={toneOf(attention.tone)} pulse={attention.pulse}>
            {attention.label}
            {attention.queuePosition !== undefined ? ` #${attention.queuePosition}` : ''}
          </Pill>
          {/* Phone-width only: above `md` the meta row never collapses, so a control to expand
              it would be a permanently disabled-looking chevron next to always-visible content. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label={detailsOpen ? 'Hide run details' : 'Show run details'}
            aria-controls={detailsId}
            aria-expanded={detailsOpen}
            onClick={toggleDetails}
          >
            <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', detailsOpen && 'rotate-180')} />
          </Button>
        </span>
      </div>

      {/* #765: workflow, branch, tracker refs, diff, tokens and cost wrap across several rows on
          a phone. `hidden` rather than a visual-only class so the collapsed rows leave the
          accessibility tree instead of lingering as invisible-but-focusable chips. `md:block`
          keeps the desktop header exactly as it was. */}
      <div id={detailsId} data-slot="run-details" className={cn(detailsOpen ? 'block' : 'hidden', 'md:block')}>
        <MetaRow {...props} />
      </div>
    </>
  )
}

/** workflow · branch chip · references · ± · automation on the left; tokens · cost · agent badge on
 *  the right (mockup `.meta-row`, #416). Each part renders only when the props carry it — absence
 *  is absence, not a placeholder. */
function MetaRow(props: TaskHeaderProps) {
  const { meta, task, actions } = props
  const parts: ReactNode[] = [<span key="workflow">{meta.workflow}</span>]
  if (meta.branch) parts.push(<CopyBranchChip key="branch" branch={meta.branch} />)
  // EVERY PR the task points at, then the issue, in the order the Tasks table paints them. A
  // reference without a URL still gets its chip: `ReferenceChip` degrades it to inert text.
  for (const [index, reference] of (meta.references ?? []).entries()) {
    parts.push(
      <ReferenceChip
        key={`${reference.kind}-${reference.number ?? reference.url ?? index}`}
        reference={{
          kind: reference.kind === 'pr' ? 'PR' : 'Issue',
          ...(reference.number !== undefined ? { number: reference.number } : {}),
          ...(reference.url !== undefined ? { url: reference.url } : {}),
        }}
        taskTitle={task.title}
        // The props' answer, whole: no provider above this part can paint over it.
        lookup={{
          status: reference.status,
          state: reference.lookup,
          reason: reference.lookupReason,
          conflicting: reference.conflicting,
        }}
        className="h-5"
        conflictAction={conflictActionFor(reference, actions.resolveConflicts, props.onResolveConflicts)}
      />,
    )
  }
  if (meta.diff) {
    parts.push(
      <DiffStatLabel
        key="diff"
        stat={{ adds: meta.diff.added, dels: meta.diff.removed, files: meta.diff.files, repointed: meta.diff.repointed }}
      />,
    )
  }
  if (meta.automation) {
    // Provenance is history and is always shown; only the LINK is gated. Without an `href` the
    // automations page is off on this server, and following it would say nothing about this task.
    const { href } = meta.automation
    parts.push(
      href !== undefined ? (
        <a
          key="automation"
          href={href}
          onClick={(event) => {
            // A plain click stays in the cockpit; a modified or middle click keeps the browser's
            // own behaviour (a new tab), which the `href` makes possible.
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            props.onNavigate(href)
          }}
          className="rounded-sm border border-border bg-card px-1.5 py-px text-[11px] font-medium hover:text-foreground"
        >
          Automation
        </a>
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
  if (meta.usage?.inputTokens !== undefined || meta.usage?.outputTokens !== undefined) {
    usage.push(<DirectionalUsage key="tokens" inputTokens={meta.usage.inputTokens} outputTokens={meta.usage.outputTokens} />)
  }
  if (meta.usage?.costUsd) {
    usage.push(
      <span key="cost" className="tabular-nums">
        {formatCost(meta.usage.costUsd)}
      </span>,
    )
  }

  return (
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
        <AgentBadge engine={props.engine} chooseEngine={actions.chooseEngine} onChooseEngine={props.onChooseEngine} />
      </span>
    </div>
  )
}

/**
 * What a conflicting chip's panel offers: **Resolve conflicts** for a numbered pull request, while
 * the action is offered. A node, so it is mounted only while the panel is open.
 */
function conflictActionFor(
  reference: TaskHeaderReference,
  state: TaskHeaderActionState,
  onResolveConflicts: (prNumber: number) => void,
): ReactNode {
  const number = reference.number
  if (reference.kind !== 'pr' || number === undefined || !state.available) return undefined
  return <ResolveConflictsAction state={state} onResolve={() => onResolveConflicts(number)} />
}

/**
 * The panel's button. The intent returns nothing, so the panel closes when the request it sent
 * stops being pending, whether it worked or not; core's toast says which. Only this panel's own
 * press closes it: another chip's request settling leaves it open.
 */
function ResolveConflictsAction({ state, onResolve }: { state: TaskHeaderActionState; onResolve: () => void }) {
  const close = useCloseReferenceCard()
  // `idle` → `pressed` on the click → `sent` once the request shows as pending → closed on settle.
  const press = useRef<'idle' | 'pressed' | 'sent'>('idle')
  useEffect(() => {
    if (state.pending) {
      if (press.current === 'pressed') press.current = 'sent'
    } else if (press.current === 'sent') {
      press.current = 'idle'
      close()
    }
  }, [state.pending, close])

  return (
    <>
      {/* The CTA variant, not `outline`: an outline button on this panel is a card-coloured
          rectangle on a card-coloured surface. This is the only thing in the panel meant to be pressed. */}
      <Button
        type="button"
        size="sm"
        data-slot="reference-conflict-action"
        disabled={!state.enabled}
        onClick={() => {
          press.current = 'pressed'
          onResolve()
        }}
        className="h-7 w-full text-xs"
      >
        {state.pending ? 'Sending…' : 'Resolve conflicts'}
      </Button>
      {/* Only the REFUSAL is spelled out; what the button will do is the button's own words. */}
      {state.reason ? <span className="block opacity-70">{state.reason}</span> : null}
    </>
  )
}

/** Copyable task branch with confirmation kept local so hovering it does not re-render the row. */
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

/**
 * The agent icon by the token counter (#416): the runner, account and model as one quiet,
 * truncating summary, with the labelled breakdown and the canonical model identity (#546) in its
 * menu. On the Session tab of a task that can be continued, the menu also offers **Choose engine
 * for the next continuation…**, which asks core to move focus to the dock's engine picker (spec
 * Q7): the picker itself lives in the dock only.
 */
function AgentBadge({
  engine,
  chooseEngine,
  onChooseEngine,
}: {
  engine: TaskHeaderEngine
  chooseEngine: TaskHeaderActionState
  onChooseEngine: () => void
}) {
  const { runner, account, model, identity } = engine
  const summary = [runner, account, model].filter(Boolean).join(' · ')
  // Chosen from the menu: the intent runs once the menu has closed, instead of the menu handing
  // focus back to the badge, so the focus core moves to the dock's picker stays there.
  const choosing = useRef(false)
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
          <span data-slot="agent-badge-summary" className="truncate font-mono text-[11px]">
            {summary}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[9rem]"
        onCloseAutoFocus={(event) => {
          if (!choosing.current) return
          choosing.current = false
          event.preventDefault()
          onChooseEngine()
        }}
      >
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">runner: {runner}</DropdownMenuLabel>
        {/* Omitted, not guessed, when no step recorded one. */}
        {account ? (
          <DropdownMenuLabel data-slot="agent-badge-account" className="font-mono text-[11px] font-normal text-muted-foreground">
            account: {account}
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">model: {model}</DropdownMenuLabel>
        {identity ? (
          <DropdownMenuLabel data-slot="agent-badge-identity" className="font-mono text-[11px] font-normal text-muted-foreground">
            identity: {identity}
          </DropdownMenuLabel>
        ) : null}
        {chooseEngine.available ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-slot="agent-badge-choose-engine"
              disabled={!chooseEngine.enabled}
              onSelect={() => {
                choosing.current = true
              }}
            >
              Choose engine for the next continuation…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
