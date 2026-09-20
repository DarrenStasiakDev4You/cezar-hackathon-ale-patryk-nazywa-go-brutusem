import { describe, expect, it } from 'vitest'

import type { LayoutMigrationOptions } from './layout-migrations'
import { loadLayoutSchema, migrateLayoutSchema } from './layout-migrations'
import type { LayoutSchemaV2, LayoutSchemaV3 } from './layout-schema'

const placement = (id: string, componentId = `${id}.default`, required = false) => ({
  id,
  contract: { id: `${id}.contract`, version: 1 },
  component: { id: componentId },
  required,
})

const fallback: LayoutSchemaV3 = {
  page: 'task',
  schemaVersion: 3,
  zones: { top: [placement('default-header', 'cezar.task.header.default', true)], main: [] },
}

const options: LayoutMigrationOptions = {
  v1ToV2: {
    zones: [{ from: 'header', to: 'top' }],
    removePlacements: [{ componentId: 'legacy.banner' }],
  },
  v2ToV3: {
    splitPlacements: [{
      placementId: 'task-header',
      replacements: [placement('task-header-summary'), placement('task-header-actions')],
    }],
  },
}

describe('migrateLayoutSchema', () => {
  it('renames a zone, removes an optional placement and splits a component in one forward chain', () => {
    const input = {
      page: 'task',
      schemaVersion: 1 as const,
      zones: {
        header: [
          { id: 'legacy', contract: { id: 'legacy.banner', version: 1 }, component: { id: 'legacy.banner' } },
          { id: 'task-header', contract: { id: 'cezar.task.header', version: 1 }, component: { id: 'cezar.task.header.default' } },
        ],
      },
    }

    const result = migrateLayoutSchema(input, fallback, options)

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.schema.schemaVersion).toBe(3)
      expect(result.schema.zones.top!.map((item) => item.id)).toEqual(['task-header-summary', 'task-header-actions'])
      expect(result.changes.map((change) => change.code)).toEqual([
        'renamed-zone',
        'removed-placement',
        'split-placement',
      ])
    }
  })

  it('replaces a changed required component while preserving placement identity', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { top: [placement('required-header', 'old.header', true)] },
    }
    const result = migrateLayoutSchema(input, fallback, {
      v2ToV3: {
        replaceComponents: [{
          placementId: 'required-header',
          contract: { id: 'new.header', version: 1 },
          component: { id: 'new.header.default' },
        }],
      },
    })

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.schema.zones.top![0]).toEqual({
        ...placement('required-header', 'new.header.default', true),
        contract: { id: 'new.header', version: 1 },
      })
    }
  })

  it('falls back atomically when a required placement is removed without a replacement', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { top: [placement('required-header', 'old.header', true)] },
    }
    const original = JSON.stringify(input)
    const result = migrateLayoutSchema(input, fallback, { v2ToV3: { removePlacements: [{ placementId: 'required-header' }] } })

    expect(result).toMatchObject({ status: 'fallback', fallback, error: { code: 'missing-required-replacement' } })
    expect(JSON.stringify(input)).toBe(original)
  })

  it('fails closed on a zone collision and preserves the raw input', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { header: [], top: [] },
    }
    const result = migrateLayoutSchema(input, fallback, { v2ToV3: { zones: [{ from: 'header', to: 'top' }] } })

    expect(result.status).toBe('fallback')
    if (result.status === 'fallback') expect(result.error.code).toBe('zone-collision')
  })

  it('keeps unknown optional components for the resolver fallback', () => {
    const input: LayoutSchemaV2 = {
      page: 'task',
      schemaVersion: 2,
      zones: { main: [placement('extension-widget', 'missing.extension.widget', false)] },
    }
    const result = migrateLayoutSchema(input, fallback)

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') expect(result.schema.zones.main![0]?.component.id).toBe('missing.extension.widget')
  })

  it('is idempotent for v3 and does not duplicate migration changes', () => {
    const result = loadLayoutSchema(fallback, fallback, options)
    expect(result).toEqual({ status: 'current', schema: fallback, changes: [] })
  })

  it('falls back for an unknown future version without attempting a downgrade', () => {
    const result = migrateLayoutSchema({ page: 'task', schemaVersion: 9, zones: {} }, fallback)
    expect(result).toMatchObject({ status: 'fallback', fallback, error: { code: 'unsupported-version' } })
  })
})
