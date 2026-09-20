import { isValidContributionId, type ContributionId } from '@open-mercato/cezar-extension-api'

import type { AnyComponentContract } from './registry'
import { coreDefaultComponentId, resolveComponent, type ResolverRegistry } from './resolve'

/** Why a stored implementation preference was rejected or could not be persisted. */
export type ComponentPreferenceErrorCode =
  | 'invalid'
  | 'unknown-contract'
  | 'is-default'
  | 'not-found'
  | 'other-contract'
  | 'incompatible'
  | 'not-ready'
  | 'write-failed'

export class ComponentPreferenceError extends Error {
  override readonly name = 'ComponentPreferenceError' as const
  readonly code: ComponentPreferenceErrorCode
  override readonly cause?: unknown

  constructor(code: ComponentPreferenceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.code = code
    this.cause = cause
  }
}

export interface ComponentPreferenceChange {
  readonly changed: readonly ContributionId[]
  readonly reason: 'set' | 'reset' | 'hydrated' | 'write-failed'
}

export interface ComponentPreferencesStorage {
  /** Resolves to `undefined` when the authoritative read failed. */
  load(): Promise<unknown>
  /** Persists the complete `components` object, including unknown sibling keys. */
  save(components: Record<string, unknown>): Promise<void>
}

export interface ComponentPreferences {
  get(contractId: ContributionId): ContributionId | undefined
  set(contractId: ContributionId, componentId: ContributionId): Promise<void>
  reset(contractId: ContributionId): Promise<void>
  subscribe(listener: (change: ComponentPreferenceChange) => void): () => void
  revision(): number
  readonly ready: Promise<void>
}

interface Snapshot {
  readonly components: Record<string, unknown>
  readonly implementations: Record<string, ContributionId>
}

const EMPTY_SNAPSHOT: Snapshot = { components: {}, implementations: {} }

export function createComponentPreferences(options: {
  readonly registry: ResolverRegistry
  readonly contracts: readonly AnyComponentContract[]
  readonly storage: ComponentPreferencesStorage
}): ComponentPreferences {
  let snapshot: Snapshot = EMPTY_SNAPSHOT
  let hydrationFailed = false
  let revision = 0
  const listeners = new Set<(change: ComponentPreferenceChange) => void>()
  let writes = Promise.resolve()

  const notify = (change: ComponentPreferenceChange): void => {
    revision += 1
    for (const listener of [...listeners]) {
      try {
        listener(change)
      } catch (error) {
        console.error('[cezar:components] preference listener failed', error)
      }
    }
  }

  const ready = (async (): Promise<void> => {
    try {
      const loaded = await options.storage.load()
      if (loaded === undefined) {
        hydrationFailed = true
      } else {
        snapshot = normalizeSnapshot(loaded)
      }
    } catch {
      hydrationFailed = true
    }
    notify({
      changed: Object.freeze(Object.keys(snapshot.implementations) as ContributionId[]),
      reason: 'hydrated',
    })
  })()

  const contractOf = (contractId: unknown): AnyComponentContract | undefined => {
    if (typeof contractId !== 'string' || !isValidContributionId(contractId)) return undefined
    return options.contracts.find((contract) => contract.id === contractId)
  }

  const invalidId = (value: unknown): boolean => typeof value !== 'string' || !isValidContributionId(value)

  const notReady = (): ComponentPreferenceError =>
    new ComponentPreferenceError('not-ready', 'Component preferences have not hydrated; nothing was written')

  const persist = async (previous: Snapshot, change: ComponentPreferenceChange): Promise<void> => {
    try {
      await options.storage.save({
        ...snapshot.components,
        implementations: { ...snapshot.implementations },
      })
    } catch (cause) {
      snapshot = previous
      notify({ changed: change.changed, reason: 'write-failed' })
      throw new ComponentPreferenceError('write-failed', 'Component preference could not be persisted', cause)
    }
  }

  const set = (contractId: ContributionId, componentId: ContributionId): Promise<void> => {
    const operation = writes.then(async () => {
      if (invalidId(contractId) || invalidId(componentId)) {
        throw new ComponentPreferenceError('invalid', 'Component preference ids must be valid contribution ids')
      }
      const contract = contractOf(contractId)
      if (contract === undefined) {
        throw new ComponentPreferenceError('unknown-contract', `Component contract "${contractId}" is not served`)
      }
      if (componentId === coreDefaultComponentId(contract.id)) {
        throw new ComponentPreferenceError('is-default', 'Core default is restored with reset')
      }
      await ready
      if (hydrationFailed) throw notReady()

      const resolution = resolveComponent(options.registry, contract, componentId)
      if (resolution.status === 'unresolved') {
        throw new ComponentPreferenceError('unknown-contract', `Component contract "${contractId}" is unresolved`)
      }
      if (resolution.source !== 'preference') {
        const rejected = resolution.rejected
        if (rejected === undefined) {
          throw new ComponentPreferenceError('not-found', `Component "${componentId}" cannot be selected`)
        }
        throw new ComponentPreferenceError(
          rejected.reason,
          `Component "${componentId}" cannot be selected for "${contractId}"`,
          rejected.reason === 'incompatible' ? rejected.issues : undefined,
        )
      }

      const previous = snapshot
      snapshot = withImplementation(snapshot, contract.id, componentId)
      const changed = Object.freeze([contract.id])
      notify({ changed, reason: 'set' })
      await persist(previous, { changed, reason: 'set' })
    })
    writes = operation.then(() => undefined, () => undefined)
    return operation
  }

  const reset = (contractId: ContributionId): Promise<void> => {
    const operation = writes.then(async () => {
      if (invalidId(contractId)) {
        throw new ComponentPreferenceError('invalid', 'Component contract id must be a valid contribution id')
      }
      const contract = contractOf(contractId)
      if (contract === undefined) {
        throw new ComponentPreferenceError('unknown-contract', `Component contract "${contractId}" is not served`)
      }
      await ready
      if (hydrationFailed) throw notReady()
      if (snapshot.implementations[contract.id] === undefined) return

      const previous = snapshot
      snapshot = withoutImplementation(snapshot, contract.id)
      const changed = Object.freeze([contract.id])
      notify({ changed, reason: 'reset' })
      await persist(previous, { changed, reason: 'reset' })
    })
    writes = operation.then(() => undefined, () => undefined)
    return operation
  }

  return {
    get(contractId) {
      return typeof contractId === 'string' ? snapshot.implementations[contractId] : undefined
    },
    set,
    reset,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => revision,
    ready,
  }
}

function normalizeSnapshot(value: unknown): Snapshot {
  if (!isRecord(value)) return EMPTY_SNAPSHOT

  const implementations: Record<string, ContributionId> = {}
  if (isRecord(value.implementations)) {
    for (const [contractId, componentId] of Object.entries(value.implementations)) {
      if (isValidContributionId(contractId) && typeof componentId === 'string' && isValidContributionId(componentId)) {
        implementations[contractId] = componentId
      }
    }
  }

  return {
    components: { ...value, implementations },
    implementations,
  }
}

function withImplementation(snapshot: Snapshot, contractId: ContributionId, componentId: ContributionId): Snapshot {
  const implementations = { ...snapshot.implementations, [contractId]: componentId }
  return {
    components: { ...snapshot.components, implementations },
    implementations,
  }
}

function withoutImplementation(snapshot: Snapshot, contractId: ContributionId): Snapshot {
  const implementations = { ...snapshot.implementations }
  delete implementations[contractId]
  return {
    components: { ...snapshot.components, implementations },
    implementations,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
