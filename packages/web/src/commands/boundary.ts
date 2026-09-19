/**
 * The boundary the core task commands draw (spec `2026-09-19-migrate-task-actions-to-command-api`):
 * the API client's continue, cancel and archive functions are called from the core handlers in
 * `commands/core-commands.ts` and nowhere else. Every other path to those actions — a component, a
 * hook, the Task UI, an extension — runs the command, so the request and its cache rule live in
 * one place. `boundary.test.ts` runs this scan over the cockpit's sources.
 *
 * Pure: it reads the sources it is given and nothing else, so the test decides what to scan. How an
 * import is spelled is `lib/import-scan.ts`'s job, shared with the component boundary.
 */

import { importSites, type SourceFile } from '@/lib/import-scan'

export type { SourceFile }

/** The six client functions only a core handler may call. */
export const CLIENT_ACTIONS: ReadonlySet<string> = new Set([
  'continueRun',
  'continueProjectRun',
  'cancelRun',
  'cancelProjectRun',
  'archiveRun',
  'archiveProjectRun',
])

/** One way a file reaches a client action: `name` is the function, or `*` for the whole module. */
export interface ClientActionImport {
  readonly path: string
  readonly name: string
  readonly specifier: string
}

/** The one file allowed to import them. */
const EXEMPT = 'src/commands/core-commands.ts'
/** Where they live, without an extension. */
const CLIENT_MODULE = 'src/api/client'

/** Every import (and re-export) of a client action from a file other than the core handlers. */
export function findClientActionImports(files: readonly SourceFile[]): ClientActionImport[] {
  const found: ClientActionImport[] = []
  for (const file of files) {
    if (file.path === EXEMPT) continue
    for (const { specifier, target, clause, typeOnly } of importSites(file)) {
      if (typeOnly || target !== CLIENT_MODULE) continue
      // A dynamic import — a module loaded at run time — reaches every export, the six included.
      if (clause === null) found.push({ path: file.path, name: '*', specifier })
      else for (const name of actionNames(clause)) found.push({ path: file.path, name, specifier })
    }
  }
  return found
}

/** The client actions one declaration's clause brings in; `*` for all of them at once. */
function actionNames(rawClause: string): string[] {
  // A clause holds names and punctuation only, so its comments can go before it is read: they may
  // carry commas, braces or stars of their own.
  const clause = rawClause.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim()
  // `import * as client` and `export * from`: every export behind a name this scan cannot follow
  // (`client.cancelRun`, `const { cancelRun } = client`, `client['cancelRun']`) — so the whole
  // module counts. Import the functions you need by name instead.
  if (/(?:^|,)\s*\*/.test(clause)) return ['*']
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
  const names: string[] = []
  for (const part of named.split(',')) {
    const specifier = part.trim()
    // `type x` is erased at compile time: it cannot call anything.
    if (specifier === '' || /^type\s/.test(specifier)) continue
    const imported = specifier.split(/\s+as\s+/)[0]?.trim() ?? ''
    if (CLIENT_ACTIONS.has(imported)) names.push(imported)
  }
  return names
}
