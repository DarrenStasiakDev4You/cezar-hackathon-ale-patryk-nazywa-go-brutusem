import { isValidContributionId, type ContributionId } from '@open-mercato/cezar-extension-api'

import { coreDefaultComponentId, resolveComponent, type ResolverRegistry } from './resolve'
import type { AnyComponentContract } from './registry'

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
  /** Resolves to undefined when the source could not be read. */
  load(): Promise<unknown>
  /** Persists the whole components object, including unknown future sibling keys. */
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
  readonly siblings: Record<string, unknown>
  readonly implementations: Record<string, ContributionId>
}

const EMPTY_SNAPSHOT: Snapshot = Object.freeze({
  siblings: Object.freeze({}),
  implementations: Object.freeze({}),
})

export function createComponentPreferences(options: {
  readonly registry: ResolverRegistry
  readonly contracts: readonly AnyComponentContract[]
  readonly storage: ComponentPreferencesStorage
}): ComponentPreferences {
  let snapshot: Snapshot = EMPTY_SNAPSHOT
  let revision = 0
  let hydrated = false
  let hydrationFailed = false
  let writeChain = Promise.resolve()
  const listeners = new Set<(change: ComponentPreferenceChange) => void>()

  const notify = (change: ComponentPreferenceChange): void => {
    revision += 1
    for (const listener of [...listeners]) {
      try {
        listener(change)
      } catch {
        // A settings reader must not break another reader or the write that notified it.
      }
    }
  }

  const ready = (async () => {
    try {
      const loaded = await options.storage.load()
      if (loaded === undefined) {
        hydrationFailed = true
      } else {
        snapshot = snapshotOf(loaded)
      }
    } catch {
      hydrationFailed = true
    } finally {
      hydrated = true
      notify({ changed: [], reason: 'hydrated' })
    }
  })()

  const contractOf = (contractId: ContributionId): AnyComponentContract | undefined =>
    options.contracts.find((contract) => contract.id === contractId)

  const queueWrite = (
    contractId: ContributionId,
    update: (current: Snapshot) => Snapshot,
    reason: 'set' | 'reset',
  ): Promise<void> => {
    const operation = writeChain.then(async () => {
      const previous = snapshot
      const next = update(previous)
      if (next === previous) return
      snapshot = next
      notify({ changed: [contractId], reason })
      try {
        await options.storage.save({ ...next.siblings, implementations: { ...next.implementations } })
      } catch (cause) {
        snapshot = previous
        notify({ changed: [contractId], reason: 'write-failed' })
        throw new ComponentPreferenceError('write-failed', 'Component preference could not be saved.', cause)
      }
    })
    writeChain = operation.catch(() => undefined)
    return operation
  }

  return {
    get(contractId) {
      return snapshot.implementations[contractId]
    },

    async set(contractId, componentId) {
      if (!isValidContributionId(contractId) || !isValidContributionId(componentId)) {
        throw new ComponentPreferenceError('invalid', 'Component contract and implementation ids are invalid.')
      }
      const contract = contractOf(contractId)
      if (contract === undefined) {
        throw new ComponentPreferenceError('unknown-contract', `Component contract "${contractId}" is not served.`)
      }
      if (componentId === coreDefaultComponentId(contractId)) {
        throw new ComponentPreferenceError('is-default', 'Core is the default; use reset to remove the override.')
      }
      await ready
      if (!hydrated || hydrationFailed) {
        throw new ComponentPreferenceError('not-ready', 'Component preferences are not available yet.')
      }

      const result = resolveComponent(options.registry, contract as never, componentId)
      if (result.status === 'unresolved') {
        throw new ComponentPreferenceError('unknown-contract', `Component contract "${contractId}" is not served.`)
      }
      if (result.source !== 'preference') {
        const rejection = result.rejected
        const code = rejection?.reason === 'invalid' ? 'invalid' : rejection?.reason ?? 'not-found'
        throw new ComponentPreferenceError(code, `Implementation "${componentId}" cannot render "${contractId}".`, rejection)
      }

      return queueWrite(
        contractId,
        (current) => ({
          siblings: current.siblings,
          implementations: { ...current.implementations, [contractId]: componentId },
        }),
        'set',
      )
    },

    async reset(contractId) {
      if (!isValidContributionId(contractId)) {
        throw new ComponentPreferenceError('invalid', 'Component contract id is invalid.')
      }
      await ready
      if (!hydrated || hydrationFailed) {
        throw new ComponentPreferenceError('not-ready', 'Component preferences are not available yet.')
      }
      return queueWrite(contractId, (current) => {
        if (!(contractId in current.implementations)) return current
        const implementations = { ...current.implementations }
        delete implementations[contractId]
        return { siblings: current.siblings, implementations }
      }, 'reset')
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    revision() {
      return revision
    },

    ready,
  }
}

function snapshotOf(input: unknown): Snapshot {
  if (!isRecord(input)) return EMPTY_SNAPSHOT
  const implementationsInput = input.implementations
  const implementations: Record<string, ContributionId> = {}
  if (isRecord(implementationsInput)) {
    for (const [contractId, componentId] of Object.entries(implementationsInput)) {
      if (typeof componentId === 'string' && isValidContributionId(contractId) && isValidContributionId(componentId)) {
        implementations[contractId] = componentId
      }
    }
  }
  const siblings = { ...input }
  delete siblings.implementations
  return {
    siblings: Object.freeze(siblings),
    implementations: Object.freeze(implementations),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
