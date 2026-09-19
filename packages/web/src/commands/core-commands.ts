import type { InvalidateOptions, QueryClient, QueryKey } from '@tanstack/react-query'
import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type Disposable,
  type TaskArchiveInput,
  type TaskAttachment,
  type TaskContinueInput,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'
import { attachmentInputSchema, runnerSchema, type Runner } from '@open-mercato/cezar-api-client'

import {
  ApiError,
  archiveProjectRun,
  archiveRun,
  cancelProjectRun,
  cancelRun,
  continueProjectRun,
  continueRun,
  type ContinueOptions,
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
 *
 * `options` reach every `invalidateQueries`; `{ cancelRefetch: false }` joins a refetch already in
 * flight instead of restarting it (`useTaskRefetch`). Omitted, the calls are exactly as before.
 */
export function invalidateTaskKeys(
  queryClient: QueryClient,
  projectId?: string,
  options?: InvalidateOptions,
): Promise<void> {
  const invalidate = (queryKey: QueryKey) =>
    options === undefined
      ? queryClient.invalidateQueries({ queryKey })
      : queryClient.invalidateQueries({ queryKey }, options)
  if (projectId === undefined) return invalidate(queryKeys.runs.all)
  return Promise.all([
    invalidate(workspaceQueryKeys.runsIndex),
    invalidate(queryKeys.runs.all),
    invalidate([projectId, 'runs', 'list']),
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
      async ({ taskId, projectId, ...fields }) => {
        const options = continueOptions(fields)
        // Resolves as soon as the service accepted it — what the run header's Continue always did:
        // the engine takes over, and the event stream reports the task running again. A caller
        // that must resolve on fresh caches waits for them itself (`useTaskRefetch`).
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

/**
 * The request a validated continue input makes — the object the follow-up composer used to build:
 * a key only for a field that is present, `attachments` under the wire's `images`.
 */
function continueOptions(fields: Omit<TaskContinueInput, keyof TaskRef>): ContinueOptions {
  const { runner, model, agentProfile, text, attachments } = fields
  return {
    ...(text !== undefined ? { text } : {}),
    ...(attachments !== undefined ? { images: [...attachments] } : {}),
    // The runner went through `runnerSchema` in the validator; the cast only restores its type.
    ...(runner !== undefined ? { runner: runner as Runner } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(agentProfile !== undefined ? { agentProfile } : {}),
  }
}

// ---- validators ---------------------------------------------------------------------------
//
// They name the field and the rule, never the value: a continue carries user content (a prompt,
// file contents). Each returns a fresh object, so the handler never holds the caller's. Unknown
// keys are ignored.

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

/** The bounds `POST /runs/:id/continue` enforces (`continueSchema` in the service). */
const CONTINUE_LIMITS = { model: 200, agentProfile: 64, text: 100_000, attachments: 4 } as const

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${field} must be a string of at most ${max} characters when present`)
  }
  return value
}

function validateAttachments(value: unknown): TaskAttachment[] {
  if (!Array.isArray(value) || value.length > CONTINUE_LIMITS.attachments) {
    throw new Error(`attachments must be a list of at most ${CONTINUE_LIMITS.attachments} files when present`)
  }
  return value.map((item: unknown, index) => {
    // A fixed message rather than zod's: its text can quote the value it received.
    const parsed = attachmentInputSchema.safeParse(item)
    if (!parsed.success) {
      throw new Error(
        `attachments[${index}] must be an image, text, markdown or PDF attachment of at most 7,000,000 characters`,
      )
    }
    const { mediaType, data, name } = parsed.data
    return name === undefined ? { mediaType, data } : { mediaType, data, name }
  })
}

function validateContinue(args: readonly unknown[]): [TaskContinueInput] {
  const input = oneInput(args)
  const ref = taskRef(input)
  const { runner, model, agentProfile, text, attachments } = input
  if (runner !== undefined && !runnerSchema.safeParse(runner).success) {
    throw new Error(`runner must be one of ${runnerSchema.options.join(', ')} when present`)
  }
  const validModel = model === undefined ? undefined : boundedString(model, 'model', CONTINUE_LIMITS.model)
  const validProfile =
    agentProfile === undefined ? undefined : boundedString(agentProfile, 'agentProfile', CONTINUE_LIMITS.agentProfile)
  const validText = text === undefined ? undefined : boundedString(text, 'text', CONTINUE_LIMITS.text)
  const validAttachments = attachments === undefined ? undefined : validateAttachments(attachments)
  return [
    {
      ...ref,
      ...(runner !== undefined ? { runner: runner as string } : {}),
      // `''` stays: it is the "auto" preset, which the composer sends when that pill is picked.
      ...(validModel !== undefined ? { model: validModel } : {}),
      ...(validProfile !== undefined ? { agentProfile: validProfile } : {}),
      // A blank prompt is no prompt, exactly as the composer sends it: the engine's own
      // "Continue." applies. No files is no files.
      ...(validText !== undefined && validText.trim() !== '' ? { text: validText } : {}),
      ...(validAttachments !== undefined && validAttachments.length > 0 ? { attachments: validAttachments } : {}),
    },
  ]
}

function validateArchive(args: readonly unknown[]): [TaskArchiveInput] {
  const input = oneInput(args)
  const ref = taskRef(input)
  const { archived } = input
  if (archived === undefined) return [ref]
  if (typeof archived !== 'boolean') throw new Error('archived must be a boolean when present')
  return [{ ...ref, archived }]
}
