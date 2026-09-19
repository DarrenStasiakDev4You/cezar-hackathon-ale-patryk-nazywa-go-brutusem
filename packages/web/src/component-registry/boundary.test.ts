import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { SourceFile } from '@/lib/import-scan'

import { findCoreImplementationImports } from './boundary'

/** `packages/web`, the root every scanned path is relative to. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Every shipped cockpit source: `src/**` `.ts`/`.tsx`, tests excluded, as `commands/boundary.test.ts` reads them. */
function cockpitSources(): SourceFile[] {
  const files: SourceFile[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push({
          path: path.relative(APP_ROOT, full).split(path.sep).join('/'),
          source: readFileSync(full, 'utf8'),
        })
      }
    }
  }
  walk(path.join(APP_ROOT, 'src'))
  return files
}

const scan = (filePath: string, source: string) =>
  findCoreImplementationImports([{ path: filePath, source }]).map(({ specifier }) => specifier)

describe('findCoreImplementationImports', () => {
  it.each<[string, string, string]>([
    ['the alias', 'src/routes/task-thread/run-header.tsx', "import { CoreTaskHeaderMain } from '@/routes/task-thread/core-task-header-main'"],
    ['the alias with an extension', 'src/app.tsx', "import { CoreTaskHeaderMain } from '@/routes/task-thread/core-task-header-main.tsx'"],
    ['a sibling', 'src/routes/task-thread/run-header.tsx', "import { CoreTaskHeaderMain } from './core-task-header-main'"],
    ['a relative path from elsewhere', 'src/component-registry/component-host.tsx', "import { CoreTaskHeaderMain } from '../routes/task-thread/core-task-header-main'"],
    ['a re-export', 'src/routes/task-thread/index.ts', "export { CoreTaskHeaderMain as Header } from './core-task-header-main'"],
    ['an export-all', 'src/routes/task-thread/index.ts', "export * from './core-task-header-main'"],
    ['a dynamic import', 'src/routes.tsx', "const Header = lazy(() => import('./routes/task-thread/core-task-header-main'))"],
  ])('catches an import through %s', (_label, filePath, source) => {
    expect(scan(filePath, source)).toHaveLength(1)
  })

  it('passes a type-only import, other modules and a quoted example', () => {
    const source = [
      "import type { CoreTaskHeaderMain } from './core-task-header-main'",
      "import { RunHeader } from './run-header'",
      "import { useTaskHeaderMainProps } from './task-header-main'",
      "type Header = typeof import('./core-task-header-main')",
      "// import { CoreTaskHeaderMain } from './core-task-header-main'",
    ].join('\n')

    expect(scan('src/routes/task-thread/x.tsx', source)).toEqual([])
  })

  it('exempts core-components.ts, the one place that registers core’s defaults', () => {
    const registration = readFileSync(path.join(APP_ROOT, 'src/component-registry/core-components.ts'), 'utf8')

    expect(scan('src/component-registry/core-components.ts', registration)).toEqual([])
    // The scan is not blind to how that module really writes its import.
    expect(scan('src/component-registry/elsewhere.ts', registration)).toEqual([
      '@/routes/task-thread/core-task-composer',
      '@/routes/task-thread/core-task-header-main',
    ])
  })
})

describe('the cockpit', () => {
  it('renders core’s task header main part only through ComponentHost: nothing but core-components.ts imports it', () => {
    const sources = cockpitSources()

    expect(sources.length).toBeGreaterThan(100)
    expect(findCoreImplementationImports(sources)).toEqual([])
  })
})
