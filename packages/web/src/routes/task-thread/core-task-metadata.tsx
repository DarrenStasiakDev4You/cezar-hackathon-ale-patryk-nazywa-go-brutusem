import { BotIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

import type {
  TaskActionState,
  TaskMetadataProps,
  TaskMetadataReference,
} from '@open-mercato/cezar-extension-api'
import { DiffStatLabel } from '@/components/diff-stat'
import { DirectionalUsage } from '@/components/directional-usage'
import { Pill } from '@/components/pill'
import { ReferenceChip, useCloseReferenceCard } from '@/components/reference-chip'
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

/** Core's props-only default for `cezar.task.metadata@1`. The shell owns its box and spacing. */
export function CoreTaskMetadata(props: TaskMetadataProps): ReactElement {
  return <MetaRow {...props} />
}

/** workflow, branch, references, diff and automation on the left; usage and agent on the right. */
function MetaRow({ metadata, task, actions, intents }: TaskMetadataProps): ReactElement {
  const parts: ReactNode[] = [<span key="workflow">{metadata.workflow}</span>]
  if (metadata.branch) parts.push(<CopyBranchChip key="branch" branch={metadata.branch} />)
  for (const [index, reference] of (metadata.references ?? []).entries()) {
    parts.push(
      <ReferenceChip
        key={`${reference.kind}-${reference.number ?? reference.url ?? index}`}
        reference={{
          kind: reference.kind === 'pr' ? 'PR' : 'Issue',
          ...(reference.number !== undefined ? { number: reference.number } : {}),
          ...(reference.url !== undefined ? { url: reference.url } : {}),
        }}
        taskTitle={task.title}
        lookup={{
          status: reference.status,
          state: reference.lookup,
          reason: reference.lookupReason,
          conflicting: reference.conflicting,
        }}
        className="h-5"
        conflictAction={conflictActionFor(reference, actions.resolveConflicts, intents.resolveConflicts)}
      />,
    )
  }
  if (metadata.diff) {
    parts.push(
      <DiffStatLabel
        key="diff"
        stat={{ adds: metadata.diff.added, dels: metadata.diff.removed, files: metadata.diff.files, repointed: metadata.diff.repointed }}
      />,
    )
  }
  if (metadata.automation) {
    const { href } = metadata.automation
    parts.push(
      href !== undefined ? (
        <a
          key="automation"
          href={href}
          onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            intents.navigate?.(href)
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
  if (metadata.usage?.inputTokens !== undefined || metadata.usage?.outputTokens !== undefined) {
    usage.push(<DirectionalUsage key="tokens" inputTokens={metadata.usage.inputTokens} outputTokens={metadata.usage.outputTokens} />)
  }
  if (metadata.usage?.costUsd) usage.push(<span key="cost" className="tabular-nums">{formatCost(metadata.usage.costUsd)}</span>)

  return (
    <div data-slot="run-meta" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground md:gap-y-1">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="text-soft-foreground" aria-hidden="true">·</span> : null}
          {part}
        </Fragment>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {usage.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? <span className="text-soft-foreground" aria-hidden="true">·</span> : null}
            {part}
          </Fragment>
        ))}
        <AgentBadge engine={metadata.engine} chooseEngine={actions.chooseEngine} onChooseEngine={intents.chooseEngine} />
      </span>
    </div>
  )
}

function conflictActionFor(
  reference: TaskMetadataReference,
  state: TaskActionState,
  onResolveConflicts: ((prNumber: number) => void) | undefined,
): ReactNode {
  const number = reference.number
  if (reference.kind !== 'pr' || number === undefined || !state.available || onResolveConflicts === undefined) return undefined
  return <ResolveConflictsAction state={state} onResolve={() => onResolveConflicts(number)} />
}

function ResolveConflictsAction({ state, onResolve }: { state: TaskActionState; onResolve: () => void }): ReactElement {
  const close = useCloseReferenceCard()
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
      <Button type="button" size="sm" data-slot="reference-conflict-action" disabled={!state.enabled} onClick={() => { press.current = 'pressed'; onResolve() }} className="h-7 w-full text-xs">
        {state.pending ? 'Sending…' : 'Resolve conflicts'}
      </Button>
      {state.reason ? <span className="block opacity-70">{state.reason}</span> : null}
    </>
  )
}

function CopyBranchChip({ branch }: { branch: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (dismissTimer.current !== null) clearTimeout(dismissTimer.current) }, [])

  const copy = () => {
    if (!navigator.clipboard) {
      toast(`Branch: ${branch}`)
      return
    }
    void navigator.clipboard.writeText(branch).then(() => {
      setCopied(true)
      setTooltipOpen(true)
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
      dismissTimer.current = setTimeout(() => { dismissTimer.current = null; setTooltipOpen(false) }, 1_500)
    }).catch(() => toast(`Branch: ${branch}`))
  }

  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={(open) => { if (open && dismissTimer.current === null) setCopied(false); setTooltipOpen(open) }}>
        <TooltipTrigger asChild>
          <button type="button" data-slot="branch-chip" className="cursor-copy rounded-sm border border-border bg-card px-1.5 py-px font-mono text-[11px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={`Copy branch name ${branch}`} onClick={copy}>
            {branch}
            <span className="sr-only" role="status">{copied ? 'Branch name copied' : ''}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy branch name'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function AgentBadge({
  engine,
  chooseEngine,
  onChooseEngine,
}: {
  engine: TaskMetadataProps['metadata']['engine']
  chooseEngine: TaskActionState
  onChooseEngine: (() => void) | undefined
}): ReactElement {
  const { runner, account, model, identity } = engine
  const summary = [runner, account, model].filter(Boolean).join(' · ')
  const choosing = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-slot="agent-badge" title={summary} aria-label={`Agent: ${runner}, ${account ? `account ${account}, ` : ''}model ${model}`} className="flex min-w-0 shrink items-center gap-1.5 rounded-sm px-1 py-1 text-soft-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span data-slot="agent-badge-summary" className="truncate font-mono text-[11px]">{summary}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]" onCloseAutoFocus={(event) => {
        if (!choosing.current) return
        choosing.current = false
        event.preventDefault()
        onChooseEngine?.()
      }}>
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">runner: {runner}</DropdownMenuLabel>
        {account ? <DropdownMenuLabel data-slot="agent-badge-account" className="font-mono text-[11px] font-normal text-muted-foreground">account: {account}</DropdownMenuLabel> : null}
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">model: {model}</DropdownMenuLabel>
        {identity ? <DropdownMenuLabel data-slot="agent-badge-identity" className="font-mono text-[11px] font-normal text-muted-foreground">identity: {identity}</DropdownMenuLabel> : null}
        {chooseEngine.available ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-slot="agent-badge-choose-engine" disabled={!chooseEngine.enabled} onSelect={() => { choosing.current = true }}>
              Choose engine for the next continuation…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
