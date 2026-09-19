import { createContext, useContext, useMemo, type ReactNode } from 'react'

import type { ApiRun } from '@open-mercato/cezar-api-client'
import type { TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'

import { useActiveProjectId } from '@/lib/project-router'
import { runTitle } from '@/lib/task-groups'
import { workflowLabel } from '@/lib/tasks-table'

/**
 * The task header's replaceable part, `cezar.task.header.main@1` (spec
 * `.ai/specs/2026-09-19-component-host.md`): the contract's props for a run, and the core-only
 * context `RunHeader` puts around the host.
 *
 * An extension's implementation gets the props only. Core's default also reads this context,
 * which carries what the public contract cannot: the page's run record (not a public contract) and
 * the Session tab's engine picker (a core `ReactNode` the dock also shows).
 */

export interface TaskHeaderCore {
  readonly run: ApiRun
  /** The Session tab's engine picker for the next continuation; absent on the Git tabs. */
  readonly continuationEngine?: ReactNode
}

export const TaskHeaderCoreContext = createContext<TaskHeaderCore | null>(null)

/** The shell's run and engine picker. Throws outside `RunHeader`: only core's default reads it. */
export function useTaskHeaderCore(): TaskHeaderCore {
  const core = useContext(TaskHeaderCoreContext)
  if (core === null) throw new Error('CoreTaskHeaderMain must be rendered inside RunHeader')
  return core
}

/**
 * The contract's props for a run: memoized on the values they carry, with `task`, `meta` and
 * `plan` frozen, so an implementation that mutates them throws in strict-mode code. `title` is
 * `runTitle(run)` and `workflow` is `workflowLabel(run)`, as core's own rows show them. `projectId`
 * is `useActiveProjectId()`, which also answers for the boot project: its scope context is `null`,
 * but its URL is `/p/<boot>/…`. Every task route lives under `/p/:projectId/`, so the empty string
 * is only ever seen by a bare test render.
 */
export function useTaskHeaderMainProps(
  run: ApiRun,
  planTally?: { readonly done: number; readonly total: number },
): TaskHeaderMainProps {
  const projectId = useActiveProjectId() ?? ''
  const title = runTitle(run)
  const workflow = workflowLabel(run)
  const { id: taskId, status, branch } = run
  const added = run.diffStat?.adds
  const removed = run.diffStat?.dels
  const done = planTally?.done
  const total = planTally?.total

  return useMemo(() => {
    const task = Object.freeze({ taskId, projectId, title, status })
    const meta = Object.freeze({
      workflow,
      ...(branch ? { branch } : {}),
      ...(added !== undefined && removed !== undefined ? { diff: Object.freeze({ added, removed }) } : {}),
    })
    const plan = done !== undefined && total !== undefined ? Object.freeze({ done, total }) : undefined
    return Object.freeze(plan === undefined ? { task, meta } : { task, meta, plan })
  }, [taskId, projectId, title, status, workflow, branch, added, removed, done, total])
}
