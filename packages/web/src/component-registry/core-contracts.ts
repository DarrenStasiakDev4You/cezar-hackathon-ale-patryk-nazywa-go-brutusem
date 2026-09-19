import type { AnyComponentContract } from './registry'

/**
 * The component contracts this cockpit serves (spec `2026-09-19-component-registry`): the host's
 * own tokens, one major per id, `cezar.*` only. Ships empty, like `BUILTIN_EXTENSIONS`, so every
 * extension `provide` is recorded as `unknown-contract` for now. A core contract joins this list
 * in the same PR as the slot that renders it. `registry.test.ts` builds a registry from it, so a
 * bad token fails the gate instead of the boot.
 */
export const CORE_COMPONENT_CONTRACTS: readonly AnyComponentContract[] = []
