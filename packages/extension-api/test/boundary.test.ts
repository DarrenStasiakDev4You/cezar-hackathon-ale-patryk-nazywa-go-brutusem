import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The package's whole value is its boundary: one entry point, no runtime dependencies, and
// nothing reached from the cockpit or the service. These checks hold it there. `test/` itself is
// exempt — it imports `vitest` and `node:*`.

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = '@open-mercato/cezar-extension-api'

/** Workspaces an extension must never reach: the app, the service and their HTTP contract. */
const FORBIDDEN_PACKAGES = [
  '@open-mercato/cezar-web',
  '@open-mercato/cezar',
  '@open-mercato/cezar-api-client',
  '@open-mercato/cezar-contract',
]

interface ImportSite {
  readonly file: string
  readonly specifier: string
  /** `import type …` / `export type …` — erased from the emitted JavaScript. */
  readonly typeOnly: boolean
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/** Comments may quote import statements (TSDoc examples); they are not imports. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function findImports(file: string, source: string): ImportSite[] {
  const code = stripComments(source)
  const sites: ImportSite[] = []
  // An import/export clause is only names, braces, commas and `*` — never `:`, `=` or a paren —
  // so the pattern cannot run from a declaration like `export interface X {` into a later `from`.
  const fromClause = /\b(import|export)\s+(type\s+)?[\w\s{},*$]*?\bfrom\s*['"]([^'"]+)['"]/g
  const sideEffect = /\bimport\s*['"]([^'"]+)['"]/g
  const dynamic = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of code.matchAll(fromClause)) {
    sites.push({ file, specifier: match[3] ?? '', typeOnly: match[2] !== undefined })
  }
  for (const match of code.matchAll(sideEffect)) {
    sites.push({ file, specifier: match[1] ?? '', typeOnly: false })
  }
  for (const match of code.matchAll(dynamic)) {
    sites.push({ file, specifier: match[1] ?? '', typeOnly: false })
  }
  return sites
}

function importsUnder(dirName: string): ImportSite[] {
  return listTsFiles(join(PACKAGE_ROOT, dirName)).flatMap((file) =>
    findImports(relative(PACKAGE_ROOT, file), readFileSync(file, 'utf8')),
  )
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

/** A relative import must resolve inside `dirName` — `../../web/src/x` is relative, and still a leak. */
function staysInside(site: ImportSite, dirName: string): boolean {
  const target = resolve(PACKAGE_ROOT, dirname(site.file), site.specifier)
  const root = join(PACKAGE_ROOT, dirName)
  return target === root || target.startsWith(root + sep)
}

function namesForbiddenTarget(specifier: string): boolean {
  return (
    FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`)) ||
    /(^|\/)packages\/web(\/|$)/.test(specifier)
  )
}

function describeSite(site: ImportSite): string {
  return `${site.file}: ${site.typeOnly ? 'import type' : 'import'} '${site.specifier}'`
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  exports?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

describe('package boundary', () => {
  it('has exactly one public entry point', () => {
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(['.', './package.json'])
  })

  it('has no runtime dependencies', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([])
  })

  it('keeps its only peer — React types — optional', () => {
    expect(manifest.peerDependenciesMeta?.['@types/react']?.optional).toBe(true)
  })

  it('src/ imports only its own files and React types', () => {
    const sites = importsUnder('src')
    expect(sites.length).toBeGreaterThan(0)
    const violations = sites.filter((site) =>
      isRelative(site.specifier)
        ? !staysInside(site, 'src')
        : !(site.specifier === 'react' && site.typeOnly),
    )
    expect(violations.map(describeSite)).toEqual([])
  })

  it('examples/ import only themselves and the package by name', () => {
    const violations = importsUnder('examples').filter((site) =>
      isRelative(site.specifier) ? !staysInside(site, 'examples') : site.specifier !== PACKAGE_NAME,
    )
    expect(violations.map(describeSite)).toEqual([])
  })

  it('nothing in src/ or examples/ names the cockpit, the service or their contract', () => {
    const violations = [...importsUnder('src'), ...importsUnder('examples')].filter((site) =>
      namesForbiddenTarget(site.specifier),
    )
    expect(violations.map(describeSite)).toEqual([])
  })
})

describe('import scanner', () => {
  it('finds every import shape and tells type-only imports apart', () => {
    const source = [
      "import type { ComponentType } from 'react'",
      "import { type Foo, bar } from './bar.ts'",
      "export type { Baz } from './baz.ts'",
      "export * from './all.ts'",
      "import './side-effect.ts'",
      "const lazy = import('./lazy.ts')",
      "// import { commented } from 'react-dom'",
      "/** import { documented } from '@open-mercato/cezar-web' */",
    ].join('\n')
    expect(findImports('x.ts', source)).toEqual([
      { file: 'x.ts', specifier: 'react', typeOnly: true },
      { file: 'x.ts', specifier: './bar.ts', typeOnly: false },
      { file: 'x.ts', specifier: './baz.ts', typeOnly: true },
      { file: 'x.ts', specifier: './all.ts', typeOnly: false },
      { file: 'x.ts', specifier: './side-effect.ts', typeOnly: false },
      { file: 'x.ts', specifier: './lazy.ts', typeOnly: false },
    ])
  })

  it('flags forbidden workspaces and packages/web paths, not look-alikes', () => {
    expect(namesForbiddenTarget('@open-mercato/cezar')).toBe(true)
    expect(namesForbiddenTarget('@open-mercato/cezar-web/src/app.tsx')).toBe(true)
    expect(namesForbiddenTarget('../../web/src/app.tsx')).toBe(false)
    expect(namesForbiddenTarget('../../../packages/web/src/app.tsx')).toBe(true)
    expect(namesForbiddenTarget('@open-mercato/cezar-extension-api')).toBe(false)
  })
})
