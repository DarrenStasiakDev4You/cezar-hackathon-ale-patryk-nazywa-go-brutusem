import {
  TaskComposer,
  TaskHeaderMain,
  TaskMetadata,
  type ComponentImplementation,
  type TaskComposerProps,
  type TaskHeaderMainProps,
  type TaskMetadataProps,
} from '@open-mercato/cezar-extension-api'

import { CoreTaskComposer } from '@/routes/task-thread/core-task-composer'
import { CoreTaskHeaderMain } from '@/routes/task-thread/core-task-header-main'
import { CoreTaskMetadata } from '@/routes/task-thread/core-task-metadata'

import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentRegistry, type CockpitComponentRegistry, type ComponentRegistryOptions } from './registry'
import { coreDefaultComponentId } from './resolve'

/**
 * Core's default implementations (spec `.ai/specs/2026-09-19-component-host.md`): one per contract
 * in `CORE_COMPONENT_CONTRACTS`, each registered as `coreDefaultComponentId(contract.id)`, so the
 * resolver always has core's default to render and to fall back to.
 *
 * The ONE module that imports a core implementation, and it keeps the implementation objects to
 * itself: a page renders them only through `ComponentHost`, and `boundary.test.ts` fails on any
 * other import of one.
 */

/** Core's task header main part: today's title row, rendered from the contract's props alone. */
const coreTaskHeaderMain: ComponentImplementation<TaskHeaderMainProps> = Object.freeze({
  id: coreDefaultComponentId(TaskHeaderMain.id),
  title: 'Task header',
  description: 'Cezar’s own title and status row',
  capabilities: Object.freeze(['shows-title', 'shows-status']),
  component: CoreTaskHeaderMain,
})

const coreTaskMetadata: ComponentImplementation<TaskMetadataProps> = Object.freeze({
  id: coreDefaultComponentId(TaskMetadata.id),
  title: 'Task metadata',
  description: 'Cezar’s own metadata row: workflow, branch, references, diff, usage and agent',
  capabilities: Object.freeze(['shows-metadata', 'offers-links', 'offers-copy']),
  component: CoreTaskMetadata,
})

const coreTaskComposer: ComponentImplementation<TaskComposerProps> = Object.freeze({
  id: coreDefaultComponentId(TaskComposer.id),
  title: 'Task composer',
  description: 'Cezar’s own task reply box',
  capabilities: Object.freeze(['edits-draft', 'sends', 'shows-availability', 'attaches-files', 'chooses-engine']),
  component: CoreTaskComposer,
})

/** Registers core's default of every served contract. */
export function registerCoreComponents(registry: Pick<CockpitComponentRegistry, 'register'>): void {
  registry.register(TaskHeaderMain, coreTaskHeaderMain)
  registry.register(TaskMetadata, coreTaskMetadata)
  registry.register(TaskComposer, coreTaskComposer)
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
