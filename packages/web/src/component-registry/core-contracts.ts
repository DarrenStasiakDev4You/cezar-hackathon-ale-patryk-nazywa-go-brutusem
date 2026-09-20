import { TaskComposer, TaskHeaderMain, TaskMetadata } from '@open-mercato/cezar-extension-api'

import type { AnyComponentContract } from './registry'

/**
 * The component contracts this cockpit serves (spec `2026-09-19-component-registry`): the host's
 * own tokens, one major per id, `cezar.*` only. A core contract joins this list in the same PR as
 * the slot that renders it, and `createCoreComponentRegistry` (`core-components.ts`) registers
 * core's default for each; `core-components.test.ts` fails the gate when one is missing.
 * `registry.test.ts` builds a registry from it, so a bad core token fails the gate instead of the
 * boot.
 *
 * - `cezar.task.header.main@1`: the task header's public model and its title, status and basic
 *   meta, rendered by `RunHeader` (specs `2026-09-19-component-host` and
 *   `2026-09-19-task-header-contract`).
 */
export const CORE_COMPONENT_CONTRACTS: readonly AnyComponentContract[] = [TaskHeaderMain, TaskMetadata, TaskComposer]
