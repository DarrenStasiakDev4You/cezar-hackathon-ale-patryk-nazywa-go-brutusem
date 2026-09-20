import { PencilIcon } from 'lucide-react'
import type { ReactElement } from 'react'

import type { TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'
import { Pill } from '@/components/pill'
import type { StatusDotTone } from '@/components/status-dot'

/** Core's props-only default for `cezar.task.header.main@1`: title, plan mirror and status. */
export function CoreTaskHeaderMain(props: TaskHeaderMainProps): ReactElement {
  const { task, attention, plan } = props
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="group flex min-w-0 items-center gap-1">
        <h1 className="min-w-0 truncate text-[15px] font-semibold" title={task.prompt}>{task.title}</h1>
        <button type="button" aria-label="Rename task" onClick={props.onRename} className="shrink-0 rounded-sm p-1 text-soft-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <PencilIcon className="size-3.5" aria-hidden="true" />
        </button>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2.5">
        {plan ? <span data-slot="plan-mirror" className="hidden text-[11px] text-soft-foreground tabular-nums md:inline">Plan {plan.done}/{plan.total}</span> : null}
        <Pill dot={toneOf(attention.tone)} pulse={attention.pulse}>
          {attention.label}{attention.queuePosition !== undefined ? ` #${attention.queuePosition}` : ''}
        </Pill>
      </span>
    </div>
  )
}

const TONES: ReadonlySet<string> = new Set<StatusDotTone>(['success', 'pending', 'danger', 'violet', 'neutral'])

function toneOf(tone: string): StatusDotTone {
  return TONES.has(tone) ? (tone as StatusDotTone) : 'neutral'
}
