/**
 * The boundary core's replaceable components draw (spec `.ai/specs/2026-09-19-component-host.md`):
 * a page renders a replaceable part only through `ComponentHost`, which renders whatever the
 * resolver answers, so no page imports core's implementation of it. `core-components.ts` registers
 * core's defaults and is the one module that imports them. `boundary.test.ts` runs this scan over
 * the cockpit's sources.
 *
 * Pure, like `commands/boundary.ts`: it reads the sources it is given and nothing else. How an
 * import is spelled is `lib/import-scan.ts`'s job.
 */

import { importSites, type SourceFile } from '@/lib/import-scan'

/** Core's implementations of replaceable components, without an extension. */
export const CORE_IMPLEMENTATIONS: ReadonlySet<string> = new Set(['src/routes/task-thread/core-task-header-main'])

/** One import of a core implementation. */
export interface CoreImplementationImport {
  readonly path: string
  readonly specifier: string
}

/** The one file allowed to import them. */
const EXEMPT = 'src/component-registry/core-components.ts'

/** Every import, re-export or dynamic import of a core implementation outside `core-components.ts`. */
export function findCoreImplementationImports(files: readonly SourceFile[]): CoreImplementationImport[] {
  const found: CoreImplementationImport[] = []
  for (const file of files) {
    if (file.path === EXEMPT) continue
    for (const { specifier, target, typeOnly } of importSites(file)) {
      // `import type` is erased at compile time: it cannot render anything.
      if (!typeOnly && CORE_IMPLEMENTATIONS.has(target)) found.push({ path: file.path, specifier })
    }
  }
  return found
}
