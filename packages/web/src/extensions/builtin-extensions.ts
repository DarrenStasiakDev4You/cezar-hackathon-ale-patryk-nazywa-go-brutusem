import type { Extension } from '@open-mercato/cezar-extension-api'

/**
 * Extensions compiled into the cockpit, activated at boot in this order (spec
 * `2026-09-18-extension-registry`, Q3). Ships empty: the services an extension needs arrive in
 * later items. `host.test.ts` registers this list into a fresh registry, which guards every
 * future addition.
 */
export const BUILTIN_EXTENSIONS: readonly Extension[] = []
