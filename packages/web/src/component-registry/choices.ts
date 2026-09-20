import type { ComponentContract } from '@open-mercato/cezar-extension-api'

import {
  resolveComponent,
  type ComponentResolution,
} from './resolve'
import type { CockpitComponentRegistry, ComponentRegistration, UsableComponent } from './registry'

/** The reads needed to describe choices. The cockpit's registry is one. */
export type ChoicesRegistry = Pick<CockpitComponentRegistry, 'listUsable' | 'list' | 'get'>

export interface ComponentChoices<Props> {
  readonly status: 'resolved'
  /** Core's default: what renders with no preference. Always offered. */
  readonly default: UsableComponent<Props>
  /** Every other usable implementation, sorted by `componentId`. */
  readonly overrides: readonly UsableComponent<Props>[]
  /** Every incompatible registration of this contract, sorted by `componentId`. */
  readonly unavailable: readonly ComponentRegistration[]
}

export type ComponentChoiceList<Props> = ComponentChoices<Props> | { readonly status: 'unresolved' }

/**
 * Lists the implementations a reader may offer for a contract. The default is found through the
 * resolver, so a caller cannot accidentally compose a list that disagrees with what renders.
 * Pure, deterministic and frozen; it keeps no cache and does not log.
 */
export function listComponentChoices<Props>(
  registry: ChoicesRegistry,
  contract: ComponentContract<Props>,
): ComponentChoiceList<Props> {
  const resolution: ComponentResolution<Props> = resolveComponent(registry, contract)
  if (resolution.status === 'unresolved') return Object.freeze({ status: 'unresolved' as const })

  const defaultComponent = resolution.fallback
  const overrides = registry
    .listUsable(contract)
    .filter((candidate) => candidate.componentId !== defaultComponent.componentId)
    .sort(byComponentId)
  const unavailable = registry.list(contract.id).filter((registration) => !registration.compatible).sort(byComponentId)

  return Object.freeze({
    status: 'resolved' as const,
    default: defaultComponent,
    overrides: Object.freeze(overrides),
    unavailable: Object.freeze(unavailable),
  })
}

function byComponentId(
  left: Pick<ComponentRegistration, 'componentId'>,
  right: Pick<ComponentRegistration, 'componentId'>,
): number {
  return left.componentId < right.componentId ? -1 : left.componentId > right.componentId ? 1 : 0
}
