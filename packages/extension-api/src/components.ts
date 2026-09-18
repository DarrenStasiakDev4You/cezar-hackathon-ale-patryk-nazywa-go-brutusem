import type { ComponentType } from 'react'

import type { ContributionId } from './ids.ts'
import type { Disposable } from './lifecycle.ts'
import { createToken } from './tokens.ts'

/**
 * A replaceable component, declared by core: its id, the major `version` of its functional
 * contract, and — as types — its props. The props ARE the contract: every prop, data and
 * callbacks alike, and the TSDoc on each prop states the behaviour an implementation must honour
 * (e.g. "call `onOpen(runId)` when the user activates a row").
 */
export interface ComponentContract<Props> {
  readonly kind: 'component'
  readonly id: ContributionId
  /** Major version of the functional contract. Bumped on any incompatible props change. */
  readonly version: number
  /** Type-only phantom, as on `CommandToken`. */
  readonly __props?: (props: Props) => Props
}

/**
 * Declares a component contract: `defineComponentContract<TaskListProps>('cezar.tasks.list', { version: 1 })`.
 *
 * Throws {@link ExtensionDefinitionError} (code `invalid-id`, with every issue) when the id is not a
 * {@link ContributionId} or `version` is not a positive integer. Returns a frozen
 * `{ kind, id, version }`.
 */
export function defineComponentContract<Props>(
  id: ContributionId,
  options: { readonly version: number },
): ComponentContract<Props> {
  const version = (options as { version?: unknown } | undefined)?.version
  const versionIssues =
    typeof version === 'number' && Number.isInteger(version) && version >= 1
      ? []
      : [{ path: 'version', message: 'must be a positive integer — the major version of the contract' }]
  return createToken<ComponentContract<Props>>({ kind: 'component', id, version: version as number }, versionIssues)
}

/** The props of a contract: `ComponentProps<typeof TaskList>`. */
export type ComponentProps<C> = C extends ComponentContract<infer P> ? P : never

/** One implementation of a contract, as an extension provides it. */
export interface ComponentImplementation<Props> {
  /** Namespaced under the providing extension, e.g. `acme.compact-tasks.dense`. */
  readonly id: ContributionId
  /** Shown to the user when they choose an implementation. */
  readonly title: string
  readonly description?: string
  readonly component: ComponentType<Props>
}

/**
 * Where extensions offer alternative implementations of core components. Host semantics:
 * - **Opt-in selection.** `provide` only makes an implementation available; the user selects one
 *   per contract. Core's default implementation is always listed.
 * - **Guaranteed fallback.** A replacement that throws while rendering falls back to core's
 *   default, with a visible notice.
 * - **Versioned.** An implementation is bound to the `version` of the token it was compiled
 *   against; a host whose contract has moved to another major ignores it with a
 *   `contract-version-mismatch` diagnostic instead of rendering it with the wrong props.
 */
export interface ComponentRegistry {
  /** `NoInfer`: P comes from the contract only, so an implementation with other props is rejected. */
  provide<P>(contract: ComponentContract<P>, implementation: ComponentImplementation<NoInfer<P>>): Disposable
}
