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

import { checkPermissions, guardServices } from './permissions'

/**
 * The cockpit's extension registry (spec `.ai/specs/2026-09-18-extension-registry.md`): one entry
 * per extension id, in registration order, and the lifecycle that runs `activate()` and
 * `deactivate()` so that one extension's failure never blocks another.
 *
 * PURE on purpose. The extension API and the pure local permissions guard are its only imports — no React, no DOM, no `window`, no
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
  readonly permissions: {
    readonly requested: readonly string[]
    readonly granted: readonly string[]
  }
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

export type ExtensionServices = Pick<ExtensionContext, 'commands' | 'events' | 'storage' | 'components' | 'notifications'>

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
  /**
   * Limit on each `activate()` and `deactivate()` call. Default 10_000 ms. Clamped to what
   * `setTimeout` supports (about 24.8 days), so `Infinity` means no practical limit.
   */
  readonly timeoutMs?: number
  /**
   * Every isolated failure. Default: {@link logExtensionError}.
   * Called inside a try/catch: a throwing reporter is swallowed, never propagated.
   */
  readonly onError?: (report: ExtensionErrorReport) => void
  /**
   * Called after each status change — `registered → active`, `active → registered`, into
   * `failed` — with the new record and the one it replaced. Not called by `register`, nor when a
   * retried activation fails again (`failed → failed`). `active` is reported once the
   * extension's own registrations are live. Called inside a try/catch: a throwing callback is
   * swallowed and changes no status.
   */
  readonly onStatusChange?: (record: ExtensionRecord, previous: ExtensionRecord) => void
}

export interface ExtensionRegistry {
  /** Synchronous; runs no extension code. `{ enabled: false }` registers it `disabled`. Throws `invalid-extension` or `duplicate-extension`. */
  register(
    extension: Extension,
    options?: { readonly enabled?: boolean; readonly grantedPermissions?: readonly string[] },
  ): ExtensionRecord
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

const DEFAULT_TIMEOUT_MS = 10_000
/** `setTimeout`'s ceiling: a longer delay — `Infinity` included — overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** `activate(id)` retries a failure; `activateAll()` never does, so a crash is not re-run automatically. */
const ACTIVATABLE: readonly ExtensionStatus[] = ['registered', 'failed']
const ACTIVATED_BY_ALL: readonly ExtensionStatus[] = ['registered']

interface Entry {
  readonly extension: Extension
  /** Captured at `register` (and frozen by `defineExtension`); reassigning `extension.manifest` changes nothing. */
  readonly manifest: Readonly<ExtensionManifest>
  readonly permissions: ExtensionRecord['permissions']
  record: ExtensionRecord
  /** Tail of this extension's lifecycle chain. Every public call enqueues one step on it. */
  tail: Promise<unknown>
  /** The current activation while `active`. */
  activation: Activation | undefined
  /**
   * An `activate()`/`deactivate()` call that timed out and has not settled yet. Until it does,
   * `activate` is refused, so the extension is never inside two lifecycle calls at once.
   */
  abandoned: Promise<unknown> | undefined
}

export function createExtensionRegistry(options: ExtensionRegistryOptions): ExtensionRegistry {
  const timeoutMs = resolveTimeout(options.timeoutMs)
  const onError = options.onError ?? logExtensionError
  const entries = new Map<ExtensionId, Entry>()

  const report = (id: ExtensionId, phase: ExtensionErrorReport['phase'], error: unknown): void => {
    try {
      onError({ id, phase, error })
    } catch {
      // A throwing reporter must not break activateAll, a deactivation or a disposal.
    }
  }

  const list = (): readonly ExtensionRecord[] =>
    Object.freeze(Array.from(entries.values(), (entry) => entry.record))

  const setRecord = (entry: Entry, status: ExtensionStatus, error?: ExtensionFailure): ExtensionRecord => {
    const previous = entry.record
    const record = createRecord(entry.manifest, entry.permissions, status, error)
    entry.record = record
    if (options.onStatusChange !== undefined && previous.status !== status) {
      try {
        options.onStatusChange(record, previous)
      } catch {
        // Core's own callback: a throw must not change a status or break activateAll.
      }
    }
    return record
  }

  /** Runs `step` after every earlier step of the same extension; steps never enqueue steps. */
  const enqueue = <T>(entry: Entry, step: () => Promise<T>): Promise<T> => {
    const run = entry.tail.then(step)
    entry.tail = run.catch(() => undefined)
    return run
  }

  const lookup = (id: ExtensionId): Entry => {
    const entry = entries.get(id)
    if (entry === undefined) {
      throw new ExtensionRegistryError('unknown-extension', `No extension "${id}" is registered`)
    }
    return entry
  }

  const abandon = (entry: Entry, call: Promise<unknown>): void => {
    entry.abandoned = call
    const settled = (): void => {
      if (entry.abandoned === call) entry.abandoned = undefined
    }
    call.then(settled, settled)
  }

  // § Activation, precisely.
  const activateStep = async (entry: Entry, from: readonly ExtensionStatus[]): Promise<ExtensionRecord> => {
    if (!from.includes(entry.record.status) || entry.abandoned !== undefined) return entry.record

    const { id } = entry.manifest
    const permissionFailure = checkPermissions(entry.manifest, entry.permissions.granted)
    if (permissionFailure !== null) {
      const failure = Object.freeze(permissionFailure)
      report(id, 'activate', failure)
      return setRecord(entry, 'failed', failure)
    }
    const activation = createActivation(entry.manifest, (error) => report(id, 'dispose', error))
    // A throw from `services` counts as an activation failure, like a throw from `activate`.
    const call = invoke(() => entry.extension.activate(createContext(activation, options.services)))
    const outcome = await settleWithin(call, timeoutMs, () =>
      timeoutError('activation-timeout', `Extension "${id}" did not finish activating within ${timeoutMs} ms`),
    )

    if (outcome.ok) {
      entry.activation = activation
      return setRecord(entry, 'active')
    }
    if (outcome.timedOut) abandon(entry, call)
    report(id, 'activate', outcome.error)
    activation.end()
    return setRecord(entry, 'failed', toFailure(outcome.error))
  }

  // § Deactivation and disposal, precisely.
  const deactivateStep = async (entry: Entry): Promise<ExtensionRecord> => {
    const { activation } = entry
    if (entry.record.status !== 'active' || activation === undefined) return entry.record

    const { id } = entry.manifest
    const call = invoke(() => entry.extension.deactivate?.())
    const outcome = await settleWithin(call, timeoutMs, () =>
      timeoutError('deactivation-timeout', `Extension "${id}" did not finish deactivating within ${timeoutMs} ms`),
    )
    // Reported, never fatal: disposal still runs and the extension still leaves `active`.
    if (!outcome.ok) {
      if (outcome.timedOut) abandon(entry, call)
      report(id, 'deactivate', outcome.error)
    }
    entry.activation = undefined
    activation.end()
    return setRecord(entry, 'registered')
  }

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
      const permissions = Object.freeze({
        requested: Object.freeze([...(manifest.permissions ?? [])]),
        granted: Object.freeze([...(registerOptions?.grantedPermissions ?? [])]),
      })
      const entry: Entry = {
        extension,
        manifest,
        permissions,
        record: createRecord(
          manifest,
          permissions,
          registerOptions?.enabled === false ? 'disabled' : 'registered',
        ),
        tail: Promise.resolve(),
        activation: undefined,
        abandoned: undefined,
      }
      entries.set(manifest.id, entry)
      return entry.record
    },

    get: (id) => entries.get(id)?.record,
    list,
    listActive: () => Object.freeze(list().filter((record) => record.status === 'active')),

    async activate(id) {
      const entry = lookup(id)
      return enqueue(entry, () => activateStep(entry, ACTIVATABLE))
    },

    async activateAll() {
      // Snapshot: an extension registered while this runs is not included.
      const pending = [...entries.values()].filter((entry) => entry.record.status === 'registered')
      for (const entry of pending) {
        try {
          await enqueue(entry, () => activateStep(entry, ACTIVATED_BY_ALL))
        } catch (error) {
          // activateStep isolates everything an extension can throw; this only guards a registry
          // bug from turning into a rejection, which the boot must never see.
          report(entry.manifest.id, 'activate', error)
        }
      }
      return list()
    },

    async deactivate(id) {
      const entry = lookup(id)
      return enqueue(entry, () => deactivateStep(entry))
    },
  }
}

/** One activation: its public scope, its guarded `subscriptions`, and the switch that ends it. */
interface Activation {
  readonly scope: ExtensionScope
  readonly subscriptions: Disposable[]
  /**
   * Ends the activation: from now on the scope refuses calls with `disposed`. Then disposes
   * `subscriptions` newest first, then the tracked registrations newest first — the extension's
   * own resources go first because they may still be using its registrations. Each dispose is
   * isolated: a throw is reported and the rest continue.
   */
  end(): void
}

function createActivation(manifest: Readonly<ExtensionManifest>, reportDispose: (error: unknown) => void): Activation {
  let live = true
  const tracked = new Set<Disposable>()
  const owned: Disposable[] = []

  const disposeReported = (item: unknown): void => {
    try {
      ;(item as Disposable).dispose()
    } catch (error) {
      reportDispose(error)
    }
  }
  /** On an ended activation, whatever is handed in is disposed at once — nothing leaks — and the call fails. */
  const refuse = (item: unknown): never => {
    disposeReported(item)
    throw disposedError(manifest.id)
  }

  // Once the activation has ended, adding an element disposes it and throws `disposed`. Only
  // element writes are guarded: `push`, `unshift` and `splice` all add through them.
  const subscriptions = new Proxy(owned, {
    set(target, key, value) {
      if (!live && isArrayIndex(key)) refuse(value)
      return Reflect.set(target, key, value)
    },
  })

  const scope: ExtensionScope = Object.freeze({
    extension: manifest,
    track(registration: Disposable): Disposable {
      if (!live) refuse(registration)
      let disposed = false
      const handle: Disposable = {
        dispose() {
          if (disposed) return
          disposed = true
          tracked.delete(handle)
          registration.dispose()
        },
      }
      tracked.add(handle)
      return handle
    },
    assertLive() {
      if (!live) throw disposedError(manifest.id)
    },
  })

  return {
    scope,
    subscriptions,
    end() {
      if (!live) return
      live = false
      for (const item of owned.splice(0).reverse()) disposeReported(item)
      for (const handle of [...tracked].reverse()) disposeReported(handle)
    },
  }
}

/** A fresh context per activation; frozen, so an extension cannot swap `subscriptions` for an unguarded array. */
function createContext(activation: Activation, services: ExtensionRegistryOptions['services']): ExtensionContext {
  const effective = new Set(activation.scope.extension.permissions ?? [])
  const guarded = guardServices(activation.scope, services(activation.scope), effective)
  return Object.freeze({
    extension: activation.scope.extension,
    permissions: Object.freeze([...effective]),
    subscriptions: activation.subscriptions,
    ...guarded,
  })
}

/** Calls `fn` (an extension method, `this` bound by the caller) and turns a synchronous throw into a rejection. */
function invoke(fn: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(fn())
  } catch (error) {
    return Promise.reject(error)
  }
}

type Outcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown; readonly timedOut: boolean }

/** Never rejects. A call that outlives `ms` resolves as a timeout; its late result is ignored here. */
function settleWithin(call: Promise<unknown>, ms: number, onTimeout: () => Error): Promise<Outcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: onTimeout(), timedOut: true }), ms)
    call.then(
      () => {
        clearTimeout(timer)
        resolve({ ok: true })
      },
      (error: unknown) => {
        clearTimeout(timer)
        resolve({ ok: false, error, timedOut: false })
      },
    )
  })
}

function timeoutError(code: 'activation-timeout' | 'deactivation-timeout', message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Recognised by `isExtensionError(error, 'disposed')`: it reads `code` and `message`, never the class. */
function disposedError(id: ExtensionId): Error & { readonly code: 'disposed' } {
  return Object.assign(new Error(`Extension "${id}" has been deactivated: its context no longer accepts calls`), {
    code: 'disposed' as const,
  })
}

/** `{ code, message }` from what was thrown: a string `code` when present; a non-Error value is stringified. */
function toFailure(error: unknown): ExtensionFailure {
  try {
    const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as {
      code?: unknown
      message?: unknown
    }
    const text = typeof message === 'string' ? message : String(error)
    return Object.freeze(typeof code === 'string' ? { code, message: text } : { message: text })
  } catch {
    // A throwing getter or `toString`: the failure is still recorded.
    return Object.freeze({ message: 'the extension threw a value that cannot be read' })
  }
}

function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || Number.isNaN(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(timeoutMs, 0), MAX_TIMEOUT_MS)
}

function isArrayIndex(key: string | symbol): boolean {
  return typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)
}

function createRecord(
  manifest: Readonly<ExtensionManifest>,
  permissions: ExtensionRecord['permissions'],
  status: ExtensionStatus,
  error?: ExtensionFailure,
): ExtensionRecord {
  const { id } = manifest
  return Object.freeze(error === undefined ? { id, manifest, status, permissions } : { id, manifest, status, permissions, error })
}

/** `defineExtension` threw: keep its message and every issue (read by `code`, never `instanceof`). */
function invalidExtension(error: unknown): ExtensionRegistryError {
  const issues = isExtensionError(error, 'invalid-manifest')
    ? (error as { issues?: unknown }).issues
    : undefined
  return new ExtensionRegistryError(
    'invalid-extension',
    toFailure(error).message,
    Array.isArray(issues) ? (issues as ManifestIssue[]) : [],
    { cause: error },
  )
}
