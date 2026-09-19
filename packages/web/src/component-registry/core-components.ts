import { TaskHeaderMain, type ComponentImplementation, type TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'

import { CoreTaskHeaderMain } from '@/routes/task-thread/core-task-header-main'

import type { CockpitComponentRegistry } from './registry'
import { coreDefaultComponentId } from './resolve'

/**
 * Core's default implementations (spec `.ai/specs/2026-09-19-component-host.md`): one per contract
 * in `CORE_COMPONENT_CONTRACTS`, each registered as `coreDefaultComponentId(contract.id)`, so the
 * resolver always has core's default to render and to fall back to.
 *
 * The ONE module that imports a core implementation. A page renders it only through
 * `ComponentHost`, and `boundary.test.ts` fails on any other import of it.
 */

/** Core's task header main part: today's title row and meta row. It shows everything the contract offers. */
export const coreTaskHeaderMain: ComponentImplementation<TaskHeaderMainProps> = Object.freeze({
  id: coreDefaultComponentId(TaskHeaderMain.id),
  title: 'Task header',
  description: 'Cezar’s own title, status and meta row',
  capabilities: Object.freeze(['shows-title', 'shows-status', 'shows-meta']),
  component: CoreTaskHeaderMain,
})

/**
 * Registers core's default of every served contract. `main.tsx` calls it before
 * `startExtensionHost`, as it registers the core commands, so core always keeps its own ids; a
 * `ComponentsProvider` without a registry applies it to its own.
 */
export function registerCoreComponents(registry: CockpitComponentRegistry): void {
  registry.register(TaskHeaderMain, coreTaskHeaderMain)
}
