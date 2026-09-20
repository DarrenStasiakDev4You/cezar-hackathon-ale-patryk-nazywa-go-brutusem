import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PAGE_LAYOUT_ROOT = path.dirname(fileURLToPath(import.meta.url))

function implementationSources(): readonly string[] {
  return readdirSync(PAGE_LAYOUT_ROOT)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => readFileSync(path.join(PAGE_LAYOUT_ROOT, name), 'utf8'))
}

describe('page-layout boundary', () => {
  it('keeps generic page composition independent from concrete implementations and edit-mode DOM state', () => {
    const source = implementationSources().join('\n')

    expect(source).not.toMatch(/CoreTask(?:HeaderMain|Composer)/)
    expect(source).not.toMatch(/(?:componentId|contract\.id)\s*\)?\s*\{/)
    expect(source).not.toMatch(/React\.createElement/)
    expect(source).not.toMatch(/layout-elements/)
  })
})
