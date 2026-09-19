import type { ManifestIssue } from './manifest.ts'

/**
 * Every error code of the extension API. `invalid-manifest` and `invalid-id` are thrown by this
 * package's helpers ({@link ExtensionDefinitionError}); the rest are raised by the host:
 *
 * - `invalid-id` — also raised by the host: `register`, `execute` and `has` treat a value that is
 *   not `{ kind: 'command', id: <valid ContributionId> }` as malformed, `on`, `once`, `off` and
 *   `emit` one that is not `{ kind: 'event', id: <valid ContributionId> }`, and `provide` one
 *   that is not `{ kind: 'component', id, version }` with a valid id and a positive integer
 *   version (or an implementation whose `id` is not a valid `ContributionId`).
 * - `namespace-violation` — an id outside the calling extension's `${extension.id}.` prefix, or
 *   an extension emitting a core (`cezar.*`) event.
 * - `duplicate-registration` — a second handler for a command id, or a second component
 *   implementation with an id already provided.
 * - `command-not-found` — `execute` of an id nobody registered, or one the caller may not run.
 * - `contract-version-mismatch` — an implementation built against another major of a contract.
 *   Thrown by core registration. For an extension's `provide` it is the code of the
 *   registration's issue and of its diagnostic, and it is never thrown.
 * - `storage-quota` — a write over the host's storage limits.
 * - `disposed` — a context call after the extension was deactivated: commands, events,
 *   storage and components alike.
 * - `invalid-input` — arguments a core command's validator refused, a handler or event listener
 *   that is not a function, an event payload that is not JSON (a cycle, a `bigint`), or a
 *   component implementation field of the wrong type.
 * - `command-failed` — the command's handler threw or rejected; the original is the error's
 *   `cause`. A handler's own coded error is wrapped too, so the code always describes the call
 *   the caller made.
 * - `command-timeout` — an extension-provided handler exceeded the host's time limit.
 *
 * The union grows additively.
 */
export type ExtensionErrorCode =
  | 'invalid-manifest'
  | 'invalid-id'
  | 'namespace-violation'
  | 'duplicate-registration'
  | 'command-not-found'
  | 'contract-version-mismatch'
  | 'storage-quota'
  | 'disposed'
  | 'invalid-input'
  | 'command-failed'
  | 'command-timeout'

const ERROR_CODES: ReadonlySet<string> = new Set<ExtensionErrorCode>([
  'invalid-manifest',
  'invalid-id',
  'namespace-violation',
  'duplicate-registration',
  'command-not-found',
  'contract-version-mismatch',
  'storage-quota',
  'disposed',
  'invalid-input',
  'command-failed',
  'command-timeout',
])

/**
 * Thrown by this package's helpers at definition time — when an extension module loads — never
 * by the host. `invalid-manifest` comes from {@link defineExtension}; `invalid-id` from the token
 * helpers (`defineCommand`, `defineEvent`, `defineComponentContract`) when a token is malformed.
 */
export class ExtensionDefinitionError extends Error {
  override readonly name = 'ExtensionDefinitionError' as const
  readonly code: 'invalid-manifest' | 'invalid-id'
  /** Every rule the definition broke, not only the first. */
  readonly issues: readonly ManifestIssue[]

  constructor(code: 'invalid-manifest' | 'invalid-id', message: string, issues: readonly ManifestIssue[]) {
    super(message)
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

/**
 * `true` when `error` is an extension API error — optionally one with the given `code`.
 *
 * Duck-typed on the `code` (and an error's `message`), never `instanceof`: the host and every
 * extension bundle carry their own copy of this package, so an error raised by one copy is not an
 * instance of another copy's class — and one from another realm (a worker) is not even an
 * instance of this realm's `Error`.
 */
export function isExtensionError(
  error: unknown,
  code?: ExtensionErrorCode,
): error is Error & { code: ExtensionErrorCode } {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; message?: unknown }
  if (typeof candidate.code !== 'string' || !ERROR_CODES.has(candidate.code)) return false
  if (typeof candidate.message !== 'string') return false
  return code === undefined || candidate.code === code
}

/** `path message; path message` — the issues as one line for an error message. */
export function formatIssues(issues: readonly ManifestIssue[]): string {
  return issues.map(({ path, message }) => (path === '' ? message : `${path} ${message}`)).join('; ')
}
