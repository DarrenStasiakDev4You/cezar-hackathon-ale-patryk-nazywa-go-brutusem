import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { CORE_IMPLEMENTATION_SOURCES } from './core-sources'

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('core implementation sources', () => {
  it('matches every served contract exactly once and resolves every source', () => {
    const contractIds = CORE_COMPONENT_CONTRACTS.map((contract) => contract.id)
    const sourceIds = CORE_IMPLEMENTATION_SOURCES.map(({ contractId }) => contractId)
    expect(new Set(sourceIds)).toEqual(new Set(contractIds))
    expect(sourceIds).toHaveLength(contractIds.length)
    expect(new Set(CORE_IMPLEMENTATION_SOURCES.map(({ source }) => source)).size).toBe(CORE_IMPLEMENTATION_SOURCES.length)
    for (const { source } of CORE_IMPLEMENTATION_SOURCES) {
      expect(existsSync(path.join(WEB_ROOT, `${source}.ts`)) || existsSync(path.join(WEB_ROOT, `${source}.tsx`))).toBe(true)
    }
  })
})
