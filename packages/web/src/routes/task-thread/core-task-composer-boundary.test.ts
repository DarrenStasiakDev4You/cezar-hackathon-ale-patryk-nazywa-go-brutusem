import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { importSites, type SourceFile } from '@/lib/import-scan'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CORE_COMPOSER = 'src/routes/task-thread/core-task-composer.tsx'
const forbiddenPrefixes = ['src/api/', 'src/commands/', '@tanstack/react-query']
const forbiddenModules = new Set([
  'src/lib/project-router',
  'react-router',
  'src/routes/task-thread/task-composer',
  'src/routes/task-thread/thread-draft',
  'src/routes/task-thread/deliver-prompt',
  'src/routes/task-thread/follow-up-engine',
  'src/routes/task-thread/task-thread',
  '@open-mercato/cezar-api-client',
])

function forbiddenImports(source: string): string[] {
  return importSites({ path: CORE_COMPOSER, source })
    .filter(({ target }) => forbiddenModules.has(target) || forbiddenPrefixes.some((prefix) => target === prefix || target.startsWith(prefix)))
    .map(({ specifier }) => specifier)
}

describe('the core task composer boundary', () => {
  it('imports no core state, API, router, command or run record', () => {
    const source = readFileSync(path.join(APP_ROOT, CORE_COMPOSER), 'utf8')
    expect(forbiddenImports(source)).toEqual([])
  })

  it.each([
    "import { useRuns } from '@/api/queries'",
    "import { Link } from '@/lib/project-router'",
    "import { useCommand } from '@/commands/provider'",
    "import type { ApiRun } from '@open-mercato/cezar-api-client'",
    "import { useTaskComposerModel } from './task-composer'",
    "const draft = await import('./thread-draft')",
  ])('catches forbidden import %s', (source) => {
    expect(forbiddenImports(source)).toEqual([source.slice(source.indexOf("'") + 1, source.lastIndexOf("'"))])
  })
})
