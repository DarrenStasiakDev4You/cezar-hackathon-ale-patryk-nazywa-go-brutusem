/**
 * How a cockpit source reaches another module: every import and re-export declaration, and every
 * dynamic `import('…')`, with its specifier resolved to a path under `packages/web`. The boundary
 * scans (`commands/boundary.ts`, `component-registry/boundary.ts`) read sources through this, so
 * each one decides only what is forbidden, never how an import is spelled.
 *
 * Pure: it reads the sources it is given and nothing else, so each test decides what to scan.
 */

/** One source file, by its path relative to `packages/web` (`src/routes/…`), with `/` separators. */
export interface SourceFile {
  readonly path: string
  readonly source: string
}

/** One way a file reaches a module. */
export interface ImportSite {
  /** The specifier as written: `@/api/client`, `./client`, `react`. */
  readonly specifier: string
  /** Where it points, relative to `packages/web` and without an extension (`src/api/client`); a
   *  package specifier is its own target. */
  readonly target: string
  /** The declaration's clause (`{ a, b as c }`, `* as x`, `Default`); `null` for a dynamic
   *  import, which reaches every export of the module. */
  readonly clause: string | null
  /** `import type …` / `export type …`: erased at compile time, so it cannot run anything. */
  readonly typeOnly: boolean
}

// An import or re-export declaration at the start of a line — never one quoted in a comment,
// whose lines start with `//` or `*`. The clause may span lines (a long named list, comments in
// it included) but never runs into the next declaration: a side-effect `import './x.css'` has no
// `from` of its own. `(?=\S)` and the lazy clause leave one way to split any whitespace, so a
// line that is not a declaration fails fast.
const DECLARATION =
  /^[ \t]*(import|export)[ \t]+(?=\S)(type[ \t]+(?=\S))?((?:(?!^[ \t]*(?:import|export)\b)[\s\S])*?)\bfrom[ \t]*['"]([^'"]+)['"]/gm

/** `import('…')` — a module loaded at run time reaches every export. A `typeof import('…')` is a
 *  type: it cannot call anything. */
const DYNAMIC_IMPORT = /(?<!\btypeof\s*)\bimport[ \t]*\([ \t]*['"]([^'"]+)['"][ \t]*\)/g

/** Every declaration of `file`, in source order, then every dynamic import, in source order. */
export function importSites(file: SourceFile): ImportSite[] {
  const sites: ImportSite[] = []
  for (const match of file.source.matchAll(DECLARATION)) {
    const [, , typeOnly, clause = '', specifier = ''] = match
    sites.push({ specifier, target: resolveSpecifier(file.path, specifier), clause, typeOnly: typeOnly !== undefined })
  }
  for (const [, specifier = ''] of file.source.matchAll(DYNAMIC_IMPORT)) {
    sites.push({ specifier, target: resolveSpecifier(file.path, specifier), clause: null, typeOnly: false })
  }
  return sites
}

/**
 * Where a specifier points, relative to `packages/web` and without an extension — `@/api/client`,
 * `./client` from `src/api/` and `../api/client` from `src/routes/` all answer `src/api/client`.
 * A package specifier answers itself: it never names a cockpit module.
 */
export function resolveSpecifier(from: string, specifier: string): string {
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
