import { isExtensionError } from '@open-mercato/cezar-extension-api'

import { ApiError } from '@/api/client'

/**
 * The `ApiError` behind a failure: the error itself, or the `cause` of a `command-failed` error
 * that a core handler threw (spec `2026-09-19-migrate-task-actions-to-command-api`, Q6). That
 * includes status 0, which is how `api/client.ts` reports an unreachable server. `undefined` for
 * everything else: invalid input, timeouts, an extension handler's own errors, and non-errors.
 *
 * Cockpit-only. It is what lets a recovery path that decides on an HTTP status (the composer's 409
 * re-route, the Ask delivery's idle-teardown retry) keep deciding once its request runs through a
 * command. Extensions still receive a coded `CommandError` and nothing more.
 */
export function apiErrorOf(error: unknown): ApiError | undefined {
  if (error instanceof ApiError) return error
  if (isExtensionError(error, 'command-failed') && error.cause instanceof ApiError) return error.cause
  return undefined
}
