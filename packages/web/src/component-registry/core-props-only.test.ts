import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { importSites, type SourceFile } from '@/lib/import-scan'

import { CORE_IMPLEMENTATION_SOURCES } from './core-sources'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FORBIDDEN_PREFIXES = ['src/api/', 'src/commands/', '@tanstack/react-query', 'react-router', '@open-mercato/cezar-api-client']
const FORBIDDEN_MODULES = new Set([
  'src/lib/project-router',
  'src/routes/task-thread/task-header-main',
  'src/routes/task-thread/task-metadata',
  'src/routes/task-thread/run-header',
  'src/routes/task-thread/thread-draft',
  'src/routes/task-thread/continuation-provider',
])

function forbiddenImports(file: SourceFile): string[] {
  return importSites(file)
    .filter(({ target }) => FORBIDDEN_MODULES.has(target) || FORBIDDEN_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)))
    .map(({ specifier }) => specifier)
}

function scan(source: string, pathName = CORE_IMPLEMENTATION_SOURCES[0]?.source ?? ''): string[] {
  return forbiddenImports({ path: pathName, source })
}

describe('core implementation props-only boundary', () => {
  it('keeps every listed core default independent of run data and task-thread controllers', () => {
    for (const { source } of CORE_IMPLEMENTATION_SOURCES) {
      const file = source.endsWith('.tsx') || source.endsWith('.ts') ? source : `${source}.tsx`
      expect(forbiddenImports({ path: file, source: readFileSync(path.join(APP_ROOT, file), 'utf8') })).toEqual([])
    }
  })

  it.each<[string, string, string]>([
    ['the alias', "import { useRuns } from '@/api/queries'", '@/api/queries'],
    ['a relative path', "import { useRuns } from '../../api/queries'", '../../api/queries'],
    ['a sibling', "import { useTaskMetadataController } from './task-metadata'", './task-metadata'],
    ['a type-only import', "import type { ApiRun } from '@open-mercato/cezar-api-client'", '@open-mercato/cezar-api-client'],
    ['the router', "import { Link } from '@/lib/project-router'", '@/lib/project-router'],
    ['the header adapter', "import { useTaskHeaderModel } from './task-header-main'", './task-header-main'],
  ])('catches %s', (_label, source, specifier) => {
    expect(scan(source)).toEqual([specifier])
  })

  it('lets the presentational UI kit and public contract types through', () => {
    expect(
      scan([
        "import type { TaskMetadataProps } from '@open-mercato/cezar-extension-api'",
        "import { Pill } from '@/components/pill'",
        "import { ReferenceChip } from '@/components/reference-chip'",
        '// import { useRuns } from \'@/api/queries\'',
      ].join('\n')),
    ).toEqual([])
  })
})
