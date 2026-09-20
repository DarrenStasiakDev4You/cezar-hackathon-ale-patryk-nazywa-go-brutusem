import { describe, expect, it } from 'vitest'

import type { LayoutMigrationOptions, LayoutPlacementSpec } from './layout-migrations'
import { loadLayoutSchema, migrateLayoutSchema } from './layout-migrations'
import type { LayoutSchemaV2, LayoutSchemaV3 } from './layout-schema'

const placement = (id: string, contract = `cezar.${id}`, required = false): LayoutPlacementSpec => ({
  id,
  contract,
  contractVersion: 1,
  required,
})

const fallback: LayoutSchemaV3 = {
  page: 'task',
  schemaVersion: 3,
  zones: { top: [{ ...placement('default-header', 'cezar.task.header'), required: true }], main: [] },
}

const options: LayoutMigrationOptions = {
  v1ToV2: {
    zones: [{ from: 'header', to: 'top' }],
    removePlacements: [{ placementId: 'legacy-banner' }],
  },
  v2ToV3: {
    splitPlacements: [{
      placementId: 'task-header',
      replacements: [placement('task-header-summary', 'cezar.task.header.summary'), placement('task-header-actions', 'cezar.task.header.actions')],
    }],
  },
}

describe('migrateLayoutSchema', () => {
  it('renames a zone, removes an optional placement and splits a placement in order', () => {
    const input = {
      page: 'task',
      schemaVersion: 1 as const,
      zones: {
        header: [
          { id: 'legacy-banner', contract: 'cezar.legacy.banner', contractVersion: 1 },
          { id: 'task-header', contract: 'cezar.task.header', contractVersion: 1 },
        ],
      },
    }
    const result = migrateLayoutSchema(input, options)
    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.schema.schemaVersion).toBe(3)
      expect(result.schema.zones.top!.map((item) => item.id)).toEqual(['task-header-summary', 'task-header-actions'])
      expect(result.changes.map((change) => change.code)).toEqual(['renamed-zone', 'removed-placement', 'split-placement'])
    }
  })

  it('replaces a changed required contract while preserving placement identity', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { top: [placement('required-header', 'cezar.old.header', true)] },
    }
    const result = migrateLayoutSchema(input, {
      v2ToV3: { replaceContracts: [{ placementId: 'required-header', replacement: { contract: 'cezar.new.header', contractVersion: 2 } }] },
    })
    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') expect(result.schema.zones.top![0]).toEqual({ ...placement('required-header', 'cezar.new.header'), contractVersion: 2, required: true })
  })

  it('fails atomically when a required placement is removed without replacement', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { top: [placement('required-header', 'cezar.old.header', true)] },
    }
    const original = structuredClone(input)
    const result = migrateLayoutSchema(input, { v2ToV3: { removePlacements: [{ placementId: 'required-header' }] } })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'missing-required-replacement' }, original: input })
    expect(input).toEqual(original)
  })

  it('fails closed on a zone collision', () => {
    const input: LayoutSchemaV2 = { page: 'task', schemaVersion: 2, zones: { header: [], top: [] } }
    const result = migrateLayoutSchema(input, { v2ToV3: { zones: [{ from: 'header', to: 'top' }] } })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'zone-collision' } })
  })

  it('rejects a split that would produce duplicate placement ids', () => {
    const input: LayoutSchemaV2 = { page: 'task', schemaVersion: 2, zones: { main: [placement('source')] } }
    const result = migrateLayoutSchema(input, {
      v2ToV3: { splitPlacements: [{ placementId: 'source', replacements: [placement('same'), placement('same')] }] },
    })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'invalid-migration-output' } })
  })

  it('keeps an optional unknown contract for resolver fallback', () => {
    const input: LayoutSchemaV2 = { page: 'task', schemaVersion: 2, zones: { main: [placement('extension-widget', 'missing.extension.widget')] } }
    const result = migrateLayoutSchema(input)
    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') expect(result.schema.zones.main![0]?.contract).toBe('missing.extension.widget')
  })

  it('is idempotent for v3 and does not emit migration changes', () => {
    expect(migrateLayoutSchema(fallback, options)).toEqual({ status: 'current', schema: fallback, changes: [] })
  })

  it('preserves raw input on unknown versions and invalid JSON', () => {
    const unknown = { page: 'task', schemaVersion: 9, zones: {} }
    expect(migrateLayoutSchema(unknown)).toMatchObject({ status: 'failed', original: unknown, error: { code: 'unsupported-version' } })
    expect(migrateLayoutSchema('{')).toMatchObject({ status: 'failed', original: '{', error: { code: 'invalid-json' } })
  })

  it('maps migration failure to the complete default only at the load boundary', () => {
    const input = { page: 'task', schemaVersion: 2, zones: { top: [placement('required-header', 'cezar.old.header', true)] } }
    const result = loadLayoutSchema(input, fallback, { v2ToV3: { removePlacements: [{ placementId: 'required-header' }] } })
    expect(result).toEqual({ status: 'fallback', fallback, original: input, error: expect.objectContaining({ code: 'missing-required-replacement' }) })
  })
})
