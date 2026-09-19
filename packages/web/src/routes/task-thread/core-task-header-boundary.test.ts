import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { importSites, type SourceFile } from '@/lib/import-scan'

/**
 * Core's default task header renders from the contract's props ALONE (spec
 * `.ai/specs/2026-09-19-task-header-contract.md`, Q5): no run record, query, query client, router,
 * command or core-only context. The render test proves it renders without their providers; this
 * scan proves it cannot reach for them later without failing the gate. Type-only imports count
 * too: a type of the run record is the first step to reading one.
 */

/** `packages/web`, the root every scanned path is relative to. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CORE_HEADER = 'src/routes/task-thread/core-task-header-main.tsx'

/** Where core's default may not reach: exact modules, and every module under a prefix. */
const FORBIDDEN_PREFIXES = ['src/api/', 'src/commands/', '@tanstack/react-query', 'react-router', '@open-mercato/cezar-api-client']
const FORBIDDEN_MODULES = new Set([
  'src/lib/project-router',
  'src/routes/task-thread/task-header-main',
  'src/routes/task-thread/run-header',
  'src/routes/task-thread/thread-draft',
  'src/routes/task-thread/continuation-provider',
])

/** Every import, re-export or dynamic import of a forbidden module, by its specifier. */
function forbiddenImports(file: SourceFile): string[] {
  return importSites(file)
    .filter(({ target }) => FORBIDDEN_MODULES.has(target) || FORBIDDEN_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)))
    .map(({ specifier }) => specifier)
}

const scan = (source: string) => forbiddenImports({ path: CORE_HEADER, source })

describe('the core task header boundary', () => {
  it('core’s default imports no query, router, command, run record or task-thread internals', () => {
    const source = readFileSync(path.join(APP_ROOT, CORE_HEADER), 'utf8')

    expect(importSites({ path: CORE_HEADER, source }).length).toBeGreaterThan(5)
    expect(scan(source)).toEqual([])
  })

  it.each<[string, string, string]>([
    ['the alias', "import { useRuns } from '@/api/queries'", '@/api/queries'],
    ['a relative path', "import { useRuns } from '../../api/queries'", '../../api/queries'],
    ['a sibling', "import { useTaskHeaderModel } from './task-header-main'", './task-header-main'],
    ['a type-only import', "import type { ApiRun } from '@open-mercato/cezar-api-client'", '@open-mercato/cezar-api-client'],
    ['a package subpath', "import { useQuery } from '@tanstack/react-query/build/modern'", '@tanstack/react-query/build/modern'],
    ['the router', "import { Link } from '@/lib/project-router'", '@/lib/project-router'],
    ['react-router', "import { useNavigate } from 'react-router'", 'react-router'],
    ['a command', "import { useCommand } from '@/commands/provider'", '@/commands/provider'],
    ['a re-export', "export { RunHeader } from './run-header'", './run-header'],
    ['a dynamic import', "const draft = await import('./thread-draft')", './thread-draft'],
    ['the continuation provider', "import { useContinuationProvider } from './continuation-provider.ts'", './continuation-provider.ts'],
  ])('catches %s', (_label, source, specifier) => {
    expect(scan(source)).toEqual([specifier])
  })

  it('lets the presentational UI kit and the contract’s types through', () => {
    const source = [
      "import type { TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'",
      "import { Pill } from '@/components/pill'",
      "import { ReferenceChip } from '@/components/reference-chip'",
      "import { formatCost } from '@/lib/tasks-table'",
      "// import { useRuns } from '@/api/queries'",
    ].join('\n')

    expect(scan(source)).toEqual([])
  })
})
