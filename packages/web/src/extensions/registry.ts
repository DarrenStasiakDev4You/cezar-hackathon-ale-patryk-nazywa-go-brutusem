import {
  defineExtension,
  isExtensionError,
  type Disposable,
  type Extension,
  type ExtensionContext,
  type ExtensionId,
  type ExtensionManifest,
  type ManifestIssue,
} from '@open-mercato/cezar-extension-api'

/**
 * The cockpit's extension registry (spec `.ai/specs/2026-09-18-extension-registry.md`): one entry
 * per extension id, in registration order, and the lifecycle that runs `activate()` and
 * `deactivate()` so that one extension's failure never blocks another.
 *
 * PURE on purpose. The extension API is its only import — no React, no DOM, no `window`, no
 * module-level state — so it runs unchanged under vitest and can move into a package or a worker
 * when a second consumer appears. The services behind `ExtensionContext` are not implemented
 * here: they come from the injected `services(scope)` factory and join the lifecycle through
 * `scope.track()` and `scope.assertLive()`.
 */

export type ExtensionStatus = 'registered' | 'active' | 'failed' | 'disabled'

export interface ExtensionFailure {
  /** The thrown error's string `code` when it has one; `activation-timeout` for a timeout. */
  readonly code?: string
  readonly message: string
}

/** Immutable: every transition produces a new record. */
export interface ExtensionRecord {
  readonly id: ExtensionId
  readonly manifest: Readonly<ExtensionManifest>
  readonly status: ExtensionStatus
  /** Present only when `status` is `failed`. */
  readonly error?: ExtensionFailure
}

/** One activation's lifecycle, as the host services see it. */
export interface ExtensionScope {
  readonly extension: Readonly<ExtensionManifest>
  /**
   * Tracks a registration for disposal when this activation ends. Returns an idempotent
   * Disposable that disposes the registration early AND untracks it. On an ended activation it
   * disposes `registration` at once, then throws `disposed`, so nothing leaks.
   */
  track(registration: Disposable): Disposable
  /** Throws an error with code `disposed` (recognised by `isExtensionError`) once the activation has ended. */
  assertLive(): void
}

export type ExtensionServices = Pick<ExtensionContext, 'commands' | 'events' | 'storage' | 'components'>

export interface ExtensionErrorReport {
  readonly id: ExtensionId
  /** `register` is reported by `startExtensionHost` only: `register()` itself throws. */
  readonly phase: 'register' | 'activate' | 'deactivate' | 'dispose'
  /** What was thrown; for a timeout, an Error with code `activation-timeout` / `deactivation-timeout`. */
  readonly error: unknown
}

export interface ExtensionRegistryOptions {
  /** Builds the service half of one activation's context. Called once per activation. */
  readonly services: (scope: ExtensionScope) => ExtensionServices
  /** Limit on each `activate()` and `deactivate()` call. Default 10_000 ms. */
  readonly timeoutMs?: number
  /**
   * Every isolated failure. Default: {@link logExtensionError}.
   * Called inside a try/catch: a throwing reporter is swallowed, never propagated.
   */
  readonly onError?: (report: ExtensionErrorReport) => void
}

export interface ExtensionRegistry {
  /** Synchronous; runs no extension code. `{ enabled: false }` registers it `disabled`. Throws `invalid-extension` or `duplicate-extension`. */
  register(extension: Extension, options?: { readonly enabled?: boolean }): ExtensionRecord
  get(id: ExtensionId): ExtensionRecord | undefined
  /** Every extension, in registration order. */
  list(): readonly ExtensionRecord[]
  /** `list()` filtered to `active`, in registration order. */
  listActive(): readonly ExtensionRecord[]
  /** Resolves with the resulting record; rejects only for an unknown id. */
  activate(id: ExtensionId): Promise<ExtensionRecord>
  /**
   * Activates every extension that is `registered` when the call is made, one after another in
   * registration order, then resolves with `list()`. Never rejects.
   */
  activateAll(): Promise<readonly ExtensionRecord[]>
  /** `active` → `registered`. Resolves with the resulting record; rejects only for an unknown id. */
  deactivate(id: ExtensionId): Promise<ExtensionRecord>
}

export type ExtensionRegistryErrorCode = 'invalid-extension' | 'duplicate-extension' | 'unknown-extension'

/** Host-side misuse (bad input from cockpit code), never thrown into an extension. */
export class ExtensionRegistryError extends Error {
  override readonly name = 'ExtensionRegistryError' as const
  readonly code: ExtensionRegistryErrorCode
  /** For `invalid-extension`: every rule broken, from `defineExtension`. */
  readonly issues: readonly ManifestIssue[]

  constructor(
    code: ExtensionRegistryErrorCode,
    message: string,
    issues: readonly ManifestIssue[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

/** The default `onError`: one console line per isolated failure. */
export function logExtensionError(report: ExtensionErrorReport): void {
  console.error(`[cezar:extensions] ${report.id}: ${report.phase} failed`, report.error)
}

interface Entry {
  readonly extension: Extension
  /** Captured at `register` (and frozen by `defineExtension`); reassigning `extension.manifest` changes nothing. */
  readonly manifest: Readonly<ExtensionManifest>
  record: ExtensionRecord
}

export function createExtensionRegistry(options: ExtensionRegistryOptions): ExtensionRegistry {
  void options
  const entries = new Map<ExtensionId, Entry>()

  const list = (): readonly ExtensionRecord[] =>
    Object.freeze(Array.from(entries.values(), (entry) => entry.record))

  const notImplemented = (): Promise<never> =>
    Promise.reject(new Error('extension lifecycle is not implemented yet'))

  return {
    register(extension, registerOptions) {
      let manifest: Readonly<ExtensionManifest>
      try {
        manifest = defineExtension(extension).manifest
      } catch (error) {
        throw invalidExtension(error)
      }
      if (entries.has(manifest.id)) {
        throw new ExtensionRegistryError(
          'duplicate-extension',
          `Extension "${manifest.id}" is already registered`,
        )
      }
      const status = registerOptions?.enabled === false ? 'disabled' : 'registered'
      const entry: Entry = { extension, manifest, record: createRecord(manifest, status) }
      entries.set(manifest.id, entry)
      return entry.record
    },

    get: (id) => entries.get(id)?.record,
    list,
    listActive: () => Object.freeze(list().filter((record) => record.status === 'active')),
    activate: notImplemented,
    activateAll: notImplemented,
    deactivate: notImplemented,
  }
}

function createRecord(
  manifest: Readonly<ExtensionManifest>,
  status: ExtensionStatus,
  error?: ExtensionFailure,
): ExtensionRecord {
  const { id } = manifest
  return Object.freeze(error === undefined ? { id, manifest, status } : { id, manifest, status, error })
}

/** `defineExtension` threw: keep its message and every issue (read by `code`, never `instanceof`). */
function invalidExtension(error: unknown): ExtensionRegistryError {
  const issues = isExtensionError(error, 'invalid-manifest')
    ? (error as { issues?: unknown }).issues
    : undefined
  const message = (error as { message?: unknown } | null)?.message
  return new ExtensionRegistryError(
    'invalid-extension',
    typeof message === 'string' ? message : 'Invalid extension',
    Array.isArray(issues) ? (issues as ManifestIssue[]) : [],
    { cause: error },
  )
}
