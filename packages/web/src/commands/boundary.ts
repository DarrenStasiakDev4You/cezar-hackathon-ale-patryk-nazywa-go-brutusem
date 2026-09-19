/**
 * The boundary the core task commands draw (spec `2026-09-19-migrate-task-actions-to-command-api`):
 * the API client's continue, cancel and archive functions are called from the core handlers in
 * `commands/core-commands.ts` and nowhere else. Every other path to those actions — a component, a
 * hook, the Task UI, an extension — runs the command, so the request and its cache rule live in
 * one place. `boundary.test.ts` runs this scan over the cockpit's sources.
 *
 * Pure: it reads the sources it is given and nothing else, so the test decides what to scan.
 */

/** The six client functions only a core handler may call. */
export const CLIENT_ACTIONS: ReadonlySet<string> = new Set([
  'continueRun',
  'continueProjectRun',
  'cancelRun',
  'cancelProjectRun',
  'archiveRun',
  'archiveProjectRun',
])

/** One source file, by its path relative to `packages/web` (`src/routes/…`), with `/` separators. */
export interface SourceFile {
  readonly path: string
  readonly source: string
}

/** One way a file reaches a client action: `name` is the function, or `*` for a re-export of all. */
export interface ClientActionImport {
  readonly path: string
  readonly name: string
  readonly specifier: string
}

/** The one file allowed to import them. */
const EXEMPT = 'src/commands/core-commands.ts'
/** Where they live, without an extension. */
const CLIENT_MODULE = 'src/api/client'

// An import or re-export declaration at the start of a line — never one quoted in a comment,
// whose lines start with `//` or `*`. The clause may span lines (a long named list) but never
// runs into the next declaration: a side-effect `import './x.css'` has no `from` of its own.
const DECLARATION =
  /^[ \t]*(import|export)[ \t]+(type[ \t]+)?((?:(?!^[ \t]*(?:import|export)\b)[^;])*?)[ \t]*\bfrom[ \t]*['"]([^'"]+)['"]/gm

/** Every import (and re-export) of a client action from a file other than the core handlers. */
export function findClientActionImports(files: readonly SourceFile[]): ClientActionImport[] {
  const found: ClientActionImport[] = []
  for (const file of files) {
    if (file.path === EXEMPT) continue
    for (const match of file.source.matchAll(DECLARATION)) {
      const [, keyword, typeOnly, clause = '', specifier = ''] = match
      if (typeOnly !== undefined || resolveSpecifier(file.path, specifier) !== CLIENT_MODULE) continue
      for (const name of actionNames(keyword === 'export', clause, file.source)) {
        found.push({ path: file.path, name, specifier })
      }
    }
  }
  return found
}

/** The client actions one declaration's clause brings in. */
function actionNames(reExport: boolean, clause: string, source: string): string[] {
  const names: string[] = []
  // `export * from '…'` hands every export on, the six included.
  if (reExport && clause.trim() === '*') return ['*']
  // `import * as client` reaches them as `client.continueRun`.
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1]
  if (namespace !== undefined) {
    for (const name of CLIENT_ACTIONS) {
      if (new RegExp(`\\b${namespace}\\s*\\.\\s*${name}\\b`).test(source)) names.push(name)
    }
  }
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
  for (const part of named.split(',')) {
    const specifier = part.trim()
    // `type x` is erased at compile time: it cannot call anything.
    if (specifier === '' || /^type\s/.test(specifier)) continue
    const imported = specifier.split(/\s+as\s+/)[0]?.trim() ?? ''
    if (CLIENT_ACTIONS.has(imported)) names.push(imported)
  }
  return names
}

/**
 * Where a specifier points, relative to `packages/web` and without an extension — `@/api/client`,
 * `./client` from `src/api/` and `../api/client` from `src/routes/` all answer `src/api/client`.
 * A package specifier answers itself: it never names this module.
 */
function resolveSpecifier(from: string, specifier: string): string {
  let target: string
  if (specifier.startsWith('@/')) target = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = [...from.split('/').slice(0, -1), ...specifier.split('/')].join('/')
  } else return specifier
  const segments: string[] = []
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/').replace(/\.(?:ts|tsx|js|jsx)$/, '')
}
