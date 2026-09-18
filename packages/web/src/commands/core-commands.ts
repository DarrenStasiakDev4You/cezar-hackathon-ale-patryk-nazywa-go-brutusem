import type { QueryClient } from '@tanstack/react-query'
import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type Disposable,
  type TaskArchiveInput,
  type TaskContinueInput,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'
import { runnerSchema, type Runner } from '@open-mercato/cezar-api-client'

import {
  ApiError,
  archiveProjectRun,
  archiveRun,
  cancelProjectRun,
  cancelRun,
  continueProjectRun,
  continueRun,
} from '@/api/client'
import { queryKeys, workspaceQueryKeys } from '@/api/queries'

import type { CommandRegistry } from './registry'

/**
 * The `cezar.task.*` commands (spec `2026-09-19-command-api`, § Core task commands). Each handler
 * owns what a button used to own: the HTTP call and the cache rule. A component runs them through
 * `useCommand`, an extension through `context.commands`, and neither knows the endpoint.
 *
 * All three are public: extension code already runs in the cockpit's origin and can reach these
 * routes, so exposing them adds no capability (spec § Risks).
 */

/**
 * The cache rule for one task, in one place. Without `projectId` the task belongs to the project
 * the cockpit is showing: its runs (`queryKeys.runs.all`), exactly what the run header invalidated.
 * With `projectId`, the three keys the global Tasks page settles — the cross-project index, the
 * active scope's runs and that project's own list — because the task may live in any of them.
 */
export function invalidateTaskKeys(queryClient: QueryClient, projectId?: string): Promise<void> {
  if (projectId === undefined) return queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.runsIndex }),
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.all }),
    queryClient.invalidateQueries({ queryKey: [projectId, 'runs', 'list'] }),
  ]).then(() => undefined)
}

/** Registers the cezar.task.* commands; returns one Disposable for all of them. */
export function registerCoreCommands(
  registry: CommandRegistry,
  deps: { readonly queryClient: QueryClient },
): Disposable {
  const { queryClient } = deps

  /**
   * Runs one task request under the cache rule. Success invalidates; with `awaitRefetch` the
   * result waits for the refetch, so it arrives with fresh caches. A 409 says the record the
   * caller acted on is not the task the server has — refetch it so the UI redraws to the truth —
   * and still rejects. Any other failure changed nothing, so it leaves the caches alone (unlike
   * the global Tasks page's `onSettled`, which must undo its own optimistic patch: a caller that
   * patches optimistically keeps that rollback and invalidation itself).
   */
  const settled = async <T>(
    projectId: string | undefined,
    request: () => Promise<T>,
    { awaitRefetch }: { readonly awaitRefetch: boolean },
  ): Promise<T> => {
    let result: T
    try {
      result = await request()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) void invalidateTaskKeys(queryClient, projectId)
      throw error
    }
    const refetch = invalidateTaskKeys(queryClient, projectId)
    if (awaitRefetch) await refetch
    return result
  }

  const registrations = [
    registry.register(
      TaskContinue,
      async ({ taskId, projectId, runner }) => {
        // The runner went through `runnerSchema` in the validator; the cast only restores its type.
        const options = runner === undefined ? {} : { runner: runner as Runner }
        // Resolves as soon as the service accepted it — what the run header's Continue always did:
        // the engine takes over, and the event stream reports the task running again.
        await settled(
          projectId,
          () => (projectId === undefined ? continueRun(taskId, options) : continueProjectRun(projectId, taskId, options)),
          { awaitRefetch: false },
        )
        return { taskId, continued: true as const }
      },
      { visibility: 'public', validate: validateContinue },
    ),
    registry.register(
      TaskStop,
      async ({ taskId, projectId }) => {
        const response = await settled(
          projectId,
          () => (projectId === undefined ? cancelRun(taskId) : cancelProjectRun(projectId, taskId)),
          { awaitRefetch: true },
        )
        return { taskId, stopped: response.cancelled }
      },
      { visibility: 'public', validate: validateStop },
    ),
    registry.register(
      TaskArchive,
      async ({ taskId, projectId, archived = true }) => {
        const record = await settled(
          projectId,
          () => (projectId === undefined ? archiveRun(taskId, archived) : archiveProjectRun(projectId, taskId, archived)),
          { awaitRefetch: true },
        )
        return { taskId, archived: record.archived }
      },
      { visibility: 'public', validate: validateArchive },
    ),
  ]

  return {
    dispose() {
      for (const registration of registrations) registration.dispose()
    },
  }
}

// ---- validators ---------------------------------------------------------------------------
//
// They name the field and the rule, never the value: inputs will carry user content (a prompt)
// once the composer migrates. Each returns a fresh object, so the handler never holds the
// caller's. Unknown keys are ignored.

function oneInput(args: readonly unknown[]): Readonly<Record<string, unknown>> {
  const [input] = args
  if (args.length !== 1 || typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('expected exactly one input object')
  }
  return input as Readonly<Record<string, unknown>>
}

function taskRef(input: Readonly<Record<string, unknown>>): TaskRef {
  const { taskId, projectId } = input
  if (typeof taskId !== 'string' || taskId === '') throw new Error('taskId must be a non-empty string')
  if (projectId === undefined) return { taskId }
  if (typeof projectId !== 'string' || projectId === '') {
    throw new Error('projectId must be a non-empty string when present')
  }
  return { taskId, projectId }
}

function validateStop(args: readonly unknown[]): [TaskRef] {
  return [taskRef(oneInput(args))]
}

function validateContinue(args: readonly unknown[]): [TaskContinueInput] {
  const input = oneInput(args)
  const ref = taskRef(input)
  const { runner } = input
  if (runner === undefined) return [ref]
  if (!runnerSchema.safeParse(runner).success) {
    throw new Error(`runner must be one of ${runnerSchema.options.join(', ')} when present`)
  }
  return [{ ...ref, runner: runner as string }]
}

function validateArchive(args: readonly unknown[]): [TaskArchiveInput] {
  const input = oneInput(args)
  const ref = taskRef(input)
  const { archived } = input
  if (archived === undefined) return [ref]
  if (typeof archived !== 'boolean') throw new Error('archived must be a boolean when present')
  return [{ ...ref, archived }]
}
