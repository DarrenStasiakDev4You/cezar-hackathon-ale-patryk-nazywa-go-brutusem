import {
  checkComponentCompatibility,
  isValidContributionId,
  type ComponentCapability,
  type ComponentCompatibilityIssue,
  type ComponentContract,
  type ComponentImplementation,
  type ComponentRegistrationHandle,
  type ComponentSettingsDefinition,
  type ComponentRegistry,
  type ContributionId,
  type Disposable,
  type ExtensionErrorCode,
  type ExtensionId,
  type JsonValue,
} from '@open-mercato/cezar-extension-api'
import type { ComponentType } from 'react'

import type { ExtensionScope } from '../extensions/registry'
import { ComponentSettingsError, createMemoryComponentSettingsStore, targetForScope, type ComponentSettingsStore } from './settings'
export { ComponentSettingsError } from './settings'

/**
 * The cockpit's component registry (spec `.ai/specs/2026-09-19-component-registry.md`): every
 * implementation of a component contract, from core and from extensions, as one registration
 * with its provenance and its fit.
 *
 * The registration core stays independent of React and the DOM (React is an `import type` only),
 * while the host-owned settings store is injected through `options.settings`. No module-level
 * state is used, so it runs unchanged under vitest and outside React. `options.contracts` is the
 * host's own catalog: every implementation is checked against the host's token for its contract
 * id, never against the token the implementation brought along.
 *
 * Core registers with `register` and throws on any misfit. Each extension activation gets
 * `forExtension(scope)`, the `ComponentRegistry` it sees as `context.components`: its ids stay under
 * `${extension.id}.`, its registrations go through `scope.track()`, and an implementation that does
 * not fit is recorded with its issues and reported, never thrown (spec Q3).
 *
 * Every change is announced through `subscribe`, with `revision()` as its snapshot, so a
 * `ComponentHost` follows extensions that activate or deactivate (spec
 * `.ai/specs/2026-09-19-component-host.md`).
 */

/** Shown to the user when they choose an implementation. */
export interface ComponentMetadata {
  /** Non-empty. */
  readonly title: string
  /** Present only when the implementation gave one. */
  readonly description?: string
}

/** The check's issues, plus the one only the host can know. */
export type ComponentRegistrationIssue =
  | ComponentCompatibilityIssue
  | { readonly code: 'unknown-contract'; readonly message: string; readonly contractId: ContributionId }

/** One implementation of a contract, as the registry holds it. Deeply frozen; never mutated. */
export interface ComponentRegistration {
  /** The implementation's id: `cezar.…` for core, `${extensionId}.…` for an extension. Unique
   *  across the registry. */
  readonly componentId: ContributionId
  /** The extension that provided it, taken from the activation scope. `null`: core's own. */
  readonly extensionId: ExtensionId | null
  /** The contract the implementation was compiled against: the id and major of the token passed
   *  to `provide`/`register`, which may differ from the major the host serves. */
  readonly contractId: ContributionId
  readonly contractVersion: number
  /** Kept by reference, never called by the registry. Typed so that no props fit it: only
   *  `listUsable` hands out a component typed with its contract's props. */
  readonly component: ComponentType<never>
  /** The capabilities the implementation declared, de-duplicated, in its own order. */
  readonly declaredCapabilities: readonly ComponentCapability[]
  /** What the host may rely on: the check's `capabilities` (every required one, then the declared
   *  optional ones, in contract order). `[]` when not compatible. */
  readonly capabilities: readonly ComponentCapability[]
  readonly metadata: ComponentMetadata
  /** `true` exactly when `issues` is empty. Only a compatible registration may be rendered. */
  readonly compatible: boolean
  readonly issues: readonly ComponentRegistrationIssue[]
  readonly settings?: ComponentSettingsDefinition<unknown>
}

/** A compatible registration of the served contract, as `listUsable` returns it. */
export interface UsableComponent<Props> extends Omit<ComponentRegistration, 'component' | 'compatible' | 'issues'> {
  readonly component: ComponentType<Props>
  readonly compatible: true
  readonly issues: readonly []
}

/**
 * A contract token of any props, as the catalog holds it. `ComponentContract<unknown>` would not
 * do: its props phantom is invariant, so a typed token would not fit without a cast.
 */
export type AnyComponentContract = Omit<ComponentContract<unknown>, '__props'>

export interface ComponentRegistryOptions {
  /** The contracts this cockpit serves: the host's own tokens, one major per id, `cezar.*` ids
   *  only. Default `[]`. */
  readonly contracts?: readonly AnyComponentContract[]
  /** Called once for each registration recorded with `compatible: false`. Default:
   *  {@link logComponentDiagnostic}. Called inside a try/catch: a throwing reporter is swallowed. */
  readonly onDiagnostic?: (registration: ComponentRegistration) => void
  readonly settings?: ComponentSettingsStore
  readonly resolveProjectId?: () => string | null
}

export interface CockpitComponentRegistry {
  /** Core registration: `cezar.*` implementation ids, for a contract in `options.contracts`, and
   *  it must be compatible. Throws `ComponentError`: `invalid-id`, `namespace-violation`,
   *  `duplicate-registration`, `contract-version-mismatch`, `invalid-input`. */
  register<P, Settings>(contract: ComponentContract<P>, implementation: ComponentImplementation<NoInfer<P>, Settings>): Disposable
  /** Every registration of this contract id, compatible or not, any major, in registration order:
   *  the brief's list, and the picker's. A new frozen array per call. Never throws; a malformed
   *  argument returns `[]`. */
  list(contractId: ContributionId): readonly ComponentRegistration[]
  /** The compatible registrations of `contract.id`, in registration order, typed with its props.
   *  `[]` unless `contract` is the token the host serves: its id is in `options.contracts` at the
   *  same `version`. That compares the reader's token with the host's, never an implementation
   *  with a contract, which stays `checkComponentCompatibility`'s job. Never throws. */
  listUsable<P>(contract: ComponentContract<P>): readonly UsableComponent<P>[]
  /** The registration with this component id. Never throws. */
  get(componentId: ContributionId): ComponentRegistration | undefined
  /** The `ComponentRegistry` one extension activation sees as `context.components`. */
  forExtension(scope: ExtensionScope): ComponentRegistry
  /** Calls `listener` synchronously after every change: a `register`, a `provide`, and a dispose
   *  that removed a registration. Returns the unsubscribe, which is idempotent. A throwing listener
   *  is swallowed and does not stop the others. */
  subscribe(listener: () => void): () => void
  /** A number that grows with every change `subscribe` reports: the snapshot for
   *  `useSyncExternalStore`. */
  revision(): number
  getSettings(componentId: ContributionId): Promise<unknown | undefined>
  setSettings(componentId: ContributionId, patch: unknown): Promise<void>
  resetSettings(componentId: ContributionId, key?: string): Promise<void>
}

/** Recognised by `isExtensionError` (duck-typed on `code`), like `CommandError` and `EventError`. */
export class ComponentError extends Error {
  override readonly name = 'ComponentError' as const
  readonly code: ExtensionErrorCode
  /** The component id that was addressed, when there was a well-formed one. */
  readonly componentId?: ContributionId

  constructor(code: ExtensionErrorCode, message: string, options: { readonly componentId?: ContributionId } = {}) {
    super(message)
    this.code = code
    if (options.componentId !== undefined) this.componentId = options.componentId
  }
}

/** The default `onDiagnostic`: one console line per registration the host will not use. */
export function logComponentDiagnostic(registration: ComponentRegistration): void {
  const who = registration.extensionId ?? 'core'
  const why = registration.issues.map((issue) => issue.message).join('; ')
  console.warn(`[cezar:extensions] ${registration.componentId} (${who}) is not used: ${why}`)
}

const CORE_PREFIX = 'cezar.'
const INVALID_CONTRACT =
  'Invalid component contract: expected { kind: "component", id, version } with a valid contribution id and a positive integer version'
const INVALID_COMPONENT_ID =
  'Invalid component: id must be two or more dot-separated segments of [a-z0-9][a-z0-9-]*, at most 128 characters'
/** The most declared capabilities step 3 copies: the check's own reading limit. */
const MAX_DECLARED_CAPABILITIES = 256

/** The host's catalog entry for one contract id. */
interface ServedContract {
  readonly version: number
  /** The host's own token, passed to `checkComponentCompatibility` as the contract. */
  readonly token: AnyComponentContract
}

export function createComponentRegistry(options: ComponentRegistryOptions = {}): CockpitComponentRegistry {
  const served = catalogOf(options)
  const onDiagnostic = options.onDiagnostic ?? logComponentDiagnostic
  const settingsStore = options.settings ?? createMemoryComponentSettingsStore()
  const resolveProjectId = options.resolveProjectId ?? (() => null)
  /** Every registration by component id. The Map keeps registration order. */
  const registrations = new Map<ContributionId, ComponentRegistration>()
  /** One entry per `subscribe` call, so the same function subscribed twice is two subscriptions. */
  const listeners = new Set<{ readonly listener: () => void }>()
  const settingsListeners = new Map<string, Set<(settings: unknown | undefined) => void>>()
  const malformedSettingsReports = new Set<ContributionId>()
  let revision = 0
  /** Bumps the revision, then tells every listener subscribed at that moment. */
  const changed = (): void => {
    revision += 1
    for (const entry of [...listeners]) {
      try {
        entry.listener()
      } catch {
        // A throwing listener must not stop the others, nor fail the change that notified it.
      }
    }
  }
  settingsStore.subscribe((_target, componentId) => {
    changed()
    const listenersForComponent = settingsListeners.get(componentId)
    if (listenersForComponent) void readSettings(registrations.get(componentId), settingsStore, resolveProjectId, (registration, error) => reportMalformedSettings(registration, error)).catch(() => undefined).then((settings) => {
      for (const listener of [...listenersForComponent]) { try { listener(settings) } catch {} }
    })
  })

  /** § Providing, precisely, step 6: a component id names one registration across the registry. */
  const assertFree = (componentId: ContributionId): void => {
    const taken = registrations.get(componentId)
    if (taken === undefined) return
    throw new ComponentError(
      'duplicate-registration',
      `Component "${componentId}" is already provided by ${taken.extensionId ?? 'core'}`,
      { componentId },
    )
  }

  /** Adds `registration`; the Disposable removes exactly it, once, and never a newer one. */
  const add = (registration: ComponentRegistration): Disposable => {
    registrations.set(registration.componentId, registration)
    changed()
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        if (registrations.get(registration.componentId) === registration) {
          registrations.delete(registration.componentId)
          settingsListeners.delete(registration.componentId)
          changed()
        }
      },
    }
  }
  const handleOf = <Settings>(registration: ComponentRegistration, tracked: Disposable): ComponentRegistrationHandle<Settings> => Object.assign(tracked as ComponentRegistrationHandle<Settings>, {
    componentId: registration.componentId,
    async getSettings() { if (registrations.get(registration.componentId) !== registration) throw new ComponentSettingsError('disposed', 'Component registration is disposed'); return await readSettings(registration, settingsStore, resolveProjectId, (entry, error) => reportMalformedSettings(entry, error)) as Settings | undefined },
    onSettingsChange(listener: (settings: Settings | undefined) => void) { if (registrations.get(registration.componentId) !== registration) throw new ComponentSettingsError('disposed', 'Component registration is disposed'); let set = settingsListeners.get(registration.componentId); if (!set) { set = new Set(); settingsListeners.set(registration.componentId, set) }; const typed = listener as (settings: unknown | undefined) => void; set.add(typed); return { dispose() { set?.delete(typed); if (set?.size === 0) settingsListeners.delete(registration.componentId) } } },
  })

  /** § Providing, precisely, step 7: the fit against the host's token, or `unknown-contract`. */
  const fitOf = (input: PreparedImplementation): Fit => {
    const host = served.get(input.contractId)
    if (host === undefined) {
      const issue: ComponentRegistrationIssue = Object.freeze({
        code: 'unknown-contract',
        message: `${input.componentId} implements ${input.contractId}@${input.contractVersion}, which this Cezar does not serve`,
        contractId: input.contractId,
      })
      return Object.freeze({ capabilities: Object.freeze([]), issues: Object.freeze([issue]) })
    }
    return checkComponentCompatibility(
      host.token,
      { id: input.componentId, capabilities: input.declaredCapabilities },
      { id: input.contractId, version: input.contractVersion },
    )
  }

  const report = (registration: ComponentRegistration): void => {
    try {
      onDiagnostic(registration)
    } catch {
      // A throwing reporter must not fail the provide.
    }
  }

  const reportMalformedSettings = (registration: ComponentRegistration, error: unknown): void => {
    if (malformedSettingsReports.has(registration.componentId)) return
    malformedSettingsReports.add(registration.componentId)
    const message = error instanceof Error ? error.message : 'stored settings did not match the definition'
    console.warn(`[cezar:extensions] ${registration.componentId} settings were ignored: ${message}`)
  }

  /** Every registration that `keep` accepts, in registration order, as a new frozen array. */
  const select = (keep: (registration: ComponentRegistration) => boolean): readonly ComponentRegistration[] => {
    const found: ComponentRegistration[] = []
    for (const registration of registrations.values()) {
      if (keep(registration)) found.push(registration)
    }
    return Object.freeze(found)
  }

  return {
    register(contract, implementation) {
      const input = prepare(contract, implementation, CORE_PREFIX, (id) => `Core component "${id}" must be under "${CORE_PREFIX}"`)
      const { componentId, contractId, contractVersion } = input
      assertFree(componentId)

      // A core mistake is a bug for the tests to catch, not drift between versions: it throws.
      if (!served.has(contractId)) {
        throw new ComponentError(
          'invalid-input',
          `Core component "${componentId}" implements ${contractId}@${contractVersion}, which is not in options.contracts`,
          { componentId },
        )
      }
      const fit = fitOf(input)
      if (fit.issues.length > 0) {
        const mismatch = fit.issues.find((issue) => issue.code === 'contract-version-mismatch')
        if (mismatch !== undefined) {
          throw new ComponentError('contract-version-mismatch', mismatch.message, { componentId })
        }
        throw new ComponentError('invalid-input', fit.issues.map((issue) => issue.message).join('; '), { componentId })
      }
      return add(registrationOf(input, null, fit))
    },

    list(contractId) {
      return select((registration) => registration.contractId === contractId)
    },

    listUsable<P>(contract: ComponentContract<P>) {
      const token = tokenOf(contract)
      if (token === undefined || served.get(token.id)?.version !== token.version) return Object.freeze([])
      // Compatible means checked against the host's token, so the major is the served one.
      const usable = select((registration) => registration.contractId === token.id && registration.compatible)
      return usable as readonly UsableComponent<P>[]
    },

    get(componentId) {
      return typeof componentId === 'string' ? registrations.get(componentId) : undefined
    },

    forExtension(scope) {
      const extensionId = scope.extension.id
      const prefix = `${extensionId}.`
      return Object.freeze<ComponentRegistry>({
        provide<P, Settings>(contract: ComponentContract<P>, implementation: ComponentImplementation<NoInfer<P>, Settings>) {
          scope.assertLive()
          const input = prepare(
            contract,
            implementation,
            prefix,
            (id) => `Extension "${extensionId}" may only provide components under "${prefix}", not "${id}"`,
          )
          assertFree(input.componentId)
          // Provenance comes from the scope, never from anything the implementation claims.
          const registration = registrationOf(input, extensionId, fitOf(input))
          // On an ended activation `track` disposes the registration and throws `disposed`.
          const handle = scope.track(add(registration))
          if (!registration.compatible) report(registration)
          return handleOf<Settings>(registration, handle)
        },
      })
    },

    subscribe(listener) {
      const entry = { listener }
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },

    revision() {
      return revision
    },
    async getSettings(componentId) { const registration = registrations.get(componentId); if (!registration?.settings) return undefined; return readSettings(registration, settingsStore, resolveProjectId, (entry, error) => reportMalformedSettings(entry, error)) },
    async setSettings(componentId, patch) {
      const registration = registrations.get(componentId); const definition = registration?.settings
      if (!registration || !definition) throw new ComponentSettingsError('settings-unavailable', 'Component settings are unavailable')
      if (!isRecord(patch)) throw new ComponentSettingsError('invalid-settings', 'Component settings patch must be an object')
      let existing: unknown; try { existing = await rawSettings(registration, settingsStore, resolveProjectId) } catch (error) { throw new ComponentSettingsError('settings-unavailable', error instanceof Error ? error.message : 'Settings are unavailable') }
      let parsed: unknown; try { parsed = definition.parse({ ...(isRecord(existing) ? existing : {}), ...patch }) } catch (error) { throw new ComponentSettingsError('invalid-settings', error instanceof Error ? error.message : 'Invalid component settings') }
      try { const canonical = sparseSettings(definition, parsed); const target = targetForScope(definition.scope, resolveProjectId); if (Object.keys(canonical).length === 0) await settingsStore.clear(target, componentId); else await settingsStore.set(target, componentId, canonical as unknown as JsonValue) } catch (error) { if (error instanceof ComponentSettingsError) throw error; throw new ComponentSettingsError('settings-unavailable', error instanceof Error ? error.message : 'Settings are unavailable') }
    },
    async resetSettings(componentId, key) {
      const registration = registrations.get(componentId); const definition = registration?.settings
      if (!registration || !definition) throw new ComponentSettingsError('settings-unavailable', 'Component settings are unavailable')
      try { const target = targetForScope(definition.scope, resolveProjectId); if (key === undefined) return await settingsStore.clear(target, componentId); const existing = await rawSettings(registration, settingsStore, resolveProjectId); if (!isRecord(existing)) return; const next = { ...existing }; delete next[key]; if (Object.keys(next).length === 0) await settingsStore.clear(target, componentId); else await settingsStore.set(target, componentId, next as unknown as JsonValue) } catch (error) { if (error instanceof ComponentSettingsError) throw error; throw new ComponentSettingsError('settings-unavailable', error instanceof Error ? error.message : 'Settings are unavailable') }
    },
  }
}

/** What steps 2–5 of § Providing, precisely, read and checked: copies only, never the caller's objects. */
interface PreparedImplementation {
  readonly componentId: ContributionId
  readonly contractId: ContributionId
  readonly contractVersion: number
  readonly component: ComponentType<never>
  readonly declaredCapabilities: readonly ComponentCapability[]
  readonly metadata: ComponentMetadata
  readonly settings?: ComponentSettingsDefinition<unknown>
}

/** A fit: the check's outcome, or the host's own `unknown-contract`. Frozen. */
interface Fit {
  readonly capabilities: readonly ComponentCapability[]
  readonly issues: readonly ComponentRegistrationIssue[]
}

/**
 * § Providing, precisely, steps 2–5, shared by core and extensions: the token, the implementation's
 * fields (each read once), the id and its namespace, and each field's rule. The first failure
 * throws; the caller's own error never escapes unwrapped.
 */
function prepare(
  contract: unknown,
  implementation: unknown,
  prefix: string,
  outsidePrefix: (componentId: ContributionId) => string,
): PreparedImplementation {
  const token = tokenOf(contract)
  if (token === undefined) throw new ComponentError('invalid-id', INVALID_CONTRACT)

  const { id, title, description, capabilities, component, settings } = implementationFields(implementation)

  if (typeof id !== 'string' || !isValidContributionId(id)) throw new ComponentError('invalid-id', INVALID_COMPONENT_ID)
  if (!id.startsWith(prefix)) throw new ComponentError('namespace-violation', outsidePrefix(id), { componentId: id })

  // Named by the field and the rule, never by the value.
  const invalid = (rule: string) =>
    new ComponentError('invalid-input', `Invalid component "${id}": ${rule}`, { componentId: id })
  if (typeof title !== 'string' || title === '') throw invalid('title must be a non-empty string')
  if (description !== undefined && typeof description !== 'string') {
    throw invalid('description must be a string when given')
  }
  if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
    throw invalid('component must be a React component: a function, or an object such as memo, forwardRef or lazy return')
  }
  if (!capabilities.ok) throw invalid(`capabilities ${capabilities.rule}`)
  const settingsDefinition = settings === undefined ? undefined : snapshotSettingsDefinition(settings)
  if (settings !== undefined && settingsDefinition === undefined) throw invalid('settings must be a valid settings definition')
  const names = capabilities.names ?? []
  for (let index = 0; index < names.length; index += 1) {
    if (typeof names[index] !== 'string') throw invalid(`capabilities[${index}] must be a string`)
  }

  return {
    componentId: id,
    contractId: token.id,
    contractVersion: token.version,
    component: component as ComponentType<never>,
    declaredCapabilities: Object.freeze([...new Set(names as readonly ComponentCapability[])]),
    metadata: Object.freeze(description === undefined ? { title } : { title, description }),
    settings: settingsDefinition,
  }
}

/** The frozen registration of a prepared implementation. */
function registrationOf(input: PreparedImplementation, extensionId: ExtensionId | null, fit: Fit): ComponentRegistration {
  return Object.freeze({
    componentId: input.componentId,
    extensionId,
    contractId: input.contractId,
    contractVersion: input.contractVersion,
    component: input.component,
    declaredCapabilities: input.declaredCapabilities,
    capabilities: fit.capabilities,
    metadata: input.metadata,
    compatible: fit.issues.length === 0,
    issues: fit.issues,
    ...(input.settings === undefined ? {} : { settings: input.settings }),
  })
}

/** `capabilities` as step 3 copies it: absent, the copied elements, or the rule the list broke. */
type CapabilityCopy =
  | { readonly ok: true; readonly names: readonly unknown[] | undefined }
  | { readonly ok: false; readonly rule: string }

interface ImplementationFields {
  readonly id: unknown
  readonly title: unknown
  readonly description: unknown
  readonly capabilities: CapabilityCopy
  readonly component: unknown
  readonly settings: unknown
}

/**
 * § Providing, precisely, step 3: each field is read once, inside its own `try`, and a read that
 * throws is `invalid-input` naming the field. `capabilities` is copied in the same `try` as its
 * read: `Array.isArray` (which throws on a revoked proxy), its `length`, then each element.
 */
function implementationFields(implementation: unknown): ImplementationFields {
  if (typeof implementation !== 'object' || implementation === null) {
    throw new ComponentError('invalid-input', 'Invalid component: the implementation must be an object')
  }
  const source = implementation as Record<string, unknown>
  let named: ContributionId | undefined
  const unreadable = (key: string) =>
    new ComponentError(
      'invalid-input',
      `Invalid component${named === undefined ? '' : ` "${named}"`}: ${key} could not be read`,
      named === undefined ? {} : { componentId: named },
    )
  const read = (key: string): unknown => {
    try {
      return source[key]
    } catch {
      throw unreadable(key)
    }
  }

  const id = read('id')
  if (typeof id === 'string' && isValidContributionId(id)) named = id
  const title = read('title')
  const description = read('description')

  let capabilities: CapabilityCopy
  try {
    const list = source.capabilities
    capabilities = list === undefined ? { ok: true, names: undefined } : copyList(list)
  } catch {
    throw unreadable('capabilities')
  }

  const component = read('component')
  const settings = read('settings')
  return { id, title, description, capabilities, component, settings }
}

function snapshotSettingsDefinition(value: unknown): ComponentSettingsDefinition<unknown> | undefined {
  if (!isRecord(value) || (value.scope !== 'global' && value.scope !== 'project') || typeof value.parse !== 'function' || !isRecord(value.schema) || !isRecord(value.defaults)) return undefined
  const schema: Record<string, { readonly type: 'boolean'; readonly default: boolean }> = {}
  for (const key of Object.keys(value.schema)) {
    const descriptor = value.schema[key]
    if (!isRecord(descriptor) || descriptor.type !== 'boolean' || typeof descriptor.default !== 'boolean' || key.length === 0 || key.length > 64) return undefined
    schema[key] = Object.freeze({ type: 'boolean', default: descriptor.default })
  }
  if (Object.keys(schema).length > 64) return undefined
  const defaults: Record<string, boolean> = {}
  for (const key of Object.keys(value.defaults)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key) || typeof value.defaults[key] !== 'boolean') return undefined
    defaults[key] = value.defaults[key] as boolean
  }
  if (Object.keys(defaults).length !== Object.keys(schema).length || Object.keys(schema).some((key) => defaults[key] !== schema[key]?.default)) return undefined
  return Object.freeze({
    scope: value.scope,
    schema: Object.freeze(schema),
    defaults: Object.freeze(defaults),
    parse: value.parse as (input: unknown) => Record<string, boolean>,
  })
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function targetOf(definition: ComponentSettingsDefinition<unknown>, resolve: () => string | null) { return targetForScope(definition.scope, resolve) }
async function rawSettings(registration: ComponentRegistration, store: ComponentSettingsStore, resolve: () => string | null): Promise<unknown> { return registration.settings ? store.get(targetOf(registration.settings, resolve), registration.componentId) : undefined }
async function readSettings(registration: ComponentRegistration | undefined, store: ComponentSettingsStore, resolve: () => string | null, onMalformed?: (registration: ComponentRegistration, error: unknown) => void): Promise<unknown | undefined> {
  if (!registration?.settings) return undefined
  let raw: unknown
  try { raw = await rawSettings(registration, store, resolve) } catch (error) { if (error instanceof ComponentSettingsError) throw error; throw new ComponentSettingsError('settings-unavailable', error instanceof Error ? error.message : 'Settings are unavailable') }
  try { return registration.settings.parse(raw ?? {}) } catch (error) { onMalformed?.(registration, error); return registration.settings.defaults }
}
function sparseSettings(definition: ComponentSettingsDefinition<unknown>, parsed: unknown): Record<string, boolean> {
  if (!isRecord(parsed) || !isRecord(definition.defaults)) throw new ComponentSettingsError('invalid-settings', 'Settings parser must return an object')
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(parsed)) { if (typeof value !== 'boolean') throw new ComponentSettingsError('invalid-settings', `Setting "${key}" must be a boolean`); if (value !== definition.defaults[key]) result[key] = value }
  return result
}

/** A copy of an untrusted list of at most {@link MAX_DECLARED_CAPABILITIES} elements. May throw: the caller wraps it. */
function copyList(list: unknown): CapabilityCopy {
  if (!Array.isArray(list)) return { ok: false, rule: 'must be an array of strings' }
  const length: unknown = list.length
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    return { ok: false, rule: 'must be an array of strings' }
  }
  if (length > MAX_DECLARED_CAPABILITIES) {
    return { ok: false, rule: `must hold at most ${MAX_DECLARED_CAPABILITIES} names` }
  }
  const names: unknown[] = []
  for (let index = 0; index < length; index += 1) names.push(list[index])
  return { ok: true, names }
}

/**
 * The catalog by contract id. Throws `ComponentError` for host misuse, never the caller's own
 * error: the token's id and major, then its capability lists as the check reads them, so a token
 * the check could not use fails here rather than at every later `provide`.
 */
function catalogOf(options: ComponentRegistryOptions): ReadonlyMap<ContributionId, ServedContract> {
  let tokens: readonly unknown[]
  try {
    const contracts: unknown = options.contracts ?? []
    if (!Array.isArray(contracts)) throw new TypeError('not an array')
    tokens = [...(contracts as readonly unknown[])]
  } catch {
    throw new ComponentError('invalid-input', 'options.contracts must be an array of component contracts')
  }
  const served = new Map<ContributionId, ServedContract>()
  for (const token of tokens) {
    const read = tokenOf(token)
    if (read === undefined) throw new ComponentError('invalid-id', INVALID_CONTRACT)
    const { id, version } = read
    if (!id.startsWith(CORE_PREFIX)) {
      throw new ComponentError('namespace-violation', `Served component contract "${id}" must be under "${CORE_PREFIX}"`)
    }
    const malformed = checkComponentCompatibility(token as AnyComponentContract, { id }).issues.filter(
      (issue) => issue.code === 'malformed',
    )
    if (malformed.length > 0) {
      throw new ComponentError(
        'invalid-id',
        `Served component contract "${id}" is malformed: ${malformed.map((issue) => issue.message).join('; ')}`,
      )
    }
    const first = served.get(id)
    if (first !== undefined) {
      throw new ComponentError(
        'duplicate-registration',
        `Component contract "${id}" is served twice (@${first.version} and @${version}): one major per id`,
      )
    }
    served.set(id, { version, token: token as AnyComponentContract })
  }
  return served
}

/**
 * The id and major of a well-formed contract token, or `undefined`. Never throws, whatever it is
 * given: `kind`, `id` and `version` are each read once, inside a `try`. The capability lists are
 * not read here.
 */
function tokenOf(contract: unknown): { readonly id: ContributionId; readonly version: number } | undefined {
  try {
    if (typeof contract !== 'object' || contract === null) return undefined
    const { kind, id, version } = contract as { kind?: unknown; id?: unknown; version?: unknown }
    if (kind !== 'component' || typeof id !== 'string' || !isValidContributionId(id)) return undefined
    return isVersion(version) ? { id, version } : undefined
  } catch {
    // A throwing getter or a Proxy trap: not a token.
    return undefined
  }
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}
