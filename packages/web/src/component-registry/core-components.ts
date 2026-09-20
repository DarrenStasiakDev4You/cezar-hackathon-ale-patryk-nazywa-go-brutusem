import { TaskHeader, type ComponentImplementation, type TaskHeaderProps } from '@open-mercato/cezar-extension-api'

import { CoreTaskHeader } from '@/routes/task-thread/core-task-header'

import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentRegistry, type CockpitComponentRegistry, type ComponentRegistryOptions } from './registry'

/**
 * Core's default implementations (spec `.ai/specs/2026-09-19-component-host.md`): one per contract
 * in `CORE_COMPONENT_CONTRACTS`, each registered with `{ default: true }`, so the resolver always
 * has a declared default to render and to fall back to.
 *
 * The ONE module that imports a core implementation, and it keeps the implementation objects to
 * itself: a page renders them only through `ComponentHost`, and `boundary.test.ts` fails on any
 * other import of one.
 */

/** Core's task header main part: today's title row and meta row, rendered from the contract's props
 *  alone (spec `2026-09-19-task-header-contract`). It shows everything the contract offers. */
const coreTaskHeader: ComponentImplementation<TaskHeaderProps> = Object.freeze({
  id: 'core.task-header',
  title: 'Task header',
  description: 'Cezar’s own title, status and meta row',
  capabilities: Object.freeze(['shows-title', 'shows-status', 'shows-meta']),
  component: CoreTaskHeader,
})

/** Registers core's default of every served contract. */
export function registerCoreComponents(registry: Pick<CockpitComponentRegistry, 'register'>): void {
  registry.register(TaskHeader, coreTaskHeader, { default: true })
}

/**
 * The page's component registry: the served catalog, with core's defaults registered. `main.tsx`
 * builds it before `startExtensionHost`, as it registers the core commands, so core always keeps
 * its own ids. A `ComponentsProvider` without a registry builds its own the same way, and the gate
 * test (`core-components.test.ts`) checks what this returns.
 */
export function createCoreComponentRegistry(
  options: Omit<ComponentRegistryOptions, 'contracts'> = {},
): CockpitComponentRegistry {
  const registry = createComponentRegistry({ ...options, contracts: CORE_COMPONENT_CONTRACTS })
  registerCoreComponents(registry)
  return registry
}
