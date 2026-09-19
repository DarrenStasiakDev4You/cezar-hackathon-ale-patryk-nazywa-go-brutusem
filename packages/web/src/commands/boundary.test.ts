import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { findClientActionImports, type SourceFile } from './boundary'

/** `packages/web`, the root every scanned path is relative to. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Every shipped cockpit source: `src/**` `.ts`/`.tsx`, tests excluded. */
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
  findClientActionImports([{ path: filePath, source }]).map(({ name, specifier }) => `${name} ← ${specifier}`)

describe('findClientActionImports', () => {
  it.each<[string, string, string]>([
    ['the alias', 'src/routes/global-tasks.tsx', "import { archiveProjectRun } from '@/api/client'"],
    ['the alias with an extension', 'src/routes/global-tasks.tsx', "import { archiveProjectRun } from '@/api/client.ts'"],
    ['a sibling', 'src/api/queries.ts', "import { archiveProjectRun } from './client'"],
    ['a parent', 'src/routes/global-tasks.tsx', "import { archiveProjectRun } from '../api/client'"],
    ['a grandparent', 'src/routes/task-thread/ask-answer.ts', 'import { archiveProjectRun } from "../../api/client"'],
  ])('catches an import through %s', (_label, filePath, source) => {
    expect(scan(filePath, source)).toHaveLength(1)
  })

  it('names every action a declaration brings in, aliased or across lines', () => {
    const source = [
      "import { ApiError, cancelRun as c, getRuns } from '@/api/client'",
      'import {',
      '  continueRun,',
      '  continueProjectRun as reopen,',
      '  archiveRun,',
      "} from '@/api/client'",
      "import { cancelProjectRun, archiveProjectRun } from '@/api/client'",
    ].join('\n')

    expect(scan('src/routes/x.tsx', source)).toEqual([
      'cancelRun ← @/api/client',
      'continueRun ← @/api/client',
      'continueProjectRun ← @/api/client',
      'archiveRun ← @/api/client',
      'cancelProjectRun ← @/api/client',
      'archiveProjectRun ← @/api/client',
    ])
  })

  it('catches a namespace import that calls one, and a re-export', () => {
    const source = [
      "import * as client from '@/api/client'",
      "export { archiveRun } from '@/api/client'",
      "export * from './client'",
      'const stop = () => client.cancelRun(id)',
    ].join('\n')

    expect(scan('src/api/barrel.ts', source)).toEqual([
      'cancelRun ← @/api/client',
      'archiveRun ← @/api/client',
      '* ← ./client',
    ])
  })

  it('passes type-only imports, unrelated names, other modules and quoted examples', () => {
    const source = [
      "import './styles.css'",
      "import type { continueRun } from '@/api/client'",
      "import { type cancelRun, ApiError, getRuns } from '@/api/client'",
      "import { continueRun } from './client'",
      "import { archiveRun } from '@open-mercato/cezar-api-client'",
      "import * as client from '@/api/client'",
      '// import { cancelRun } from "@/api/client"',
      ' * import { archiveRun } from "@/api/client"',
      'void client.getRuns()',
    ].join('\n')

    // `./client` from `src/routes/` is `src/routes/client`, not the API client.
    expect(scan('src/routes/x.tsx', source)).toEqual([])
  })

  it('exempts the core handlers, the one place allowed to call them', () => {
    expect(scan('src/commands/core-commands.ts', "import { continueRun } from '@/api/client'")).toEqual([])
  })

  it('reads the core handlers’ real imports — the scan is not blind to how this codebase writes them', () => {
    const handlers = readFileSync(path.join(APP_ROOT, 'src/commands/core-commands.ts'), 'utf8')

    expect(scan('src/commands/elsewhere.ts', handlers).map((line) => line.split(' ')[0]).sort()).toEqual([
      'archiveProjectRun',
      'archiveRun',
      'cancelProjectRun',
      'cancelRun',
      'continueProjectRun',
      'continueRun',
    ])
  })
})

describe('the cockpit', () => {
  it('reaches the continue, cancel and archive client functions only through the core commands', () => {
    const sources = cockpitSources()

    expect(sources.length).toBeGreaterThan(100)
    expect(findClientActionImports(sources)).toEqual([])
  })
})
