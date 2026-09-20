import type { LayoutPlacementLayout } from '@open-mercato/cezar-extension-api'

import {
  cloneLayoutSchema,
  parseLayoutJson,
  parseLayoutSchema,
  type LayoutPlacementV1,
  type LayoutPlacementV2,
  type LayoutPlacementV3,
  type LayoutSchema,
  type LayoutSchemaV1,
  type LayoutSchemaV2,
  type LayoutSchemaV3,
} from './layout-schema'

export type LayoutChangeCode = 'renamed-zone' | 'removed-placement' | 'split-placement' | 'replaced-contract'

export type LayoutChange = {
  readonly code: LayoutChangeCode
  readonly path: string
  readonly from?: string
  readonly to?: string
}

export type LayoutMigrationErrorCode =
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-version'
  | 'zone-collision'
  | 'missing-required-replacement'
  | 'missing-required-placement'
  | 'invalid-migration-output'

export type LayoutMigrationError = {
  readonly code: LayoutMigrationErrorCode
  readonly path: string
  readonly message: string
}

export type LayoutPlacementSpec = {
  readonly id: string
  readonly contract: string
  readonly contractVersion: number
  readonly layout?: LayoutPlacementLayout
  readonly required?: boolean
}

export type LayoutPlacementSelector = {
  readonly placementId?: string
  readonly contract?: string
}

export type LayoutZoneRename = LayoutPlacementSelector & {
  readonly from: string
  readonly to: string
  readonly merge?: 'append' | 'prepend'
}

export type LayoutPlacementSplit = LayoutPlacementSelector & {
  readonly replacements: readonly LayoutPlacementSpec[]
}

export type LayoutContractReplacement = LayoutPlacementSelector & {
  readonly replacement: {
    readonly contract: string
    readonly contractVersion: number
  }
}

export type LayoutMigrationRules = {
  readonly zones?: readonly LayoutZoneRename[]
  readonly removePlacements?: readonly LayoutPlacementSelector[]
  readonly splitPlacements?: readonly LayoutPlacementSplit[]
  readonly replaceContracts?: readonly LayoutContractReplacement[]
}

export type LayoutMigrationOptions = {
  readonly v1ToV2?: LayoutMigrationRules
  readonly v2ToV3?: LayoutMigrationRules
}

export type LayoutMigrationResult =
  | { readonly status: 'current' | 'migrated'; readonly schema: LayoutSchemaV3; readonly changes: readonly LayoutChange[] }
  | { readonly status: 'failed'; readonly error: LayoutMigrationError; readonly original: unknown }

export type LayoutLoadResult =
  | { readonly status: 'current' | 'migrated'; readonly schema: LayoutSchemaV3; readonly changes: readonly LayoutChange[] }
  | { readonly status: 'fallback'; readonly fallback: LayoutSchemaV3; readonly error: LayoutMigrationError; readonly original: unknown }

const EMPTY_RULES: LayoutMigrationRules = Object.freeze({})

const migrationError = (code: LayoutMigrationErrorCode, path: string, message: string): LayoutMigrationError => ({ code, path, message })

const clonePlacement = (placement: LayoutPlacementV1 | LayoutPlacementV2 | LayoutPlacementV3): LayoutPlacementV3 => ({
  id: placement.id,
  contract: placement.contract,
  contractVersion: placement.contractVersion,
  ...(placement.layout === undefined ? {} : { layout: { ...placement.layout } }),
  required: 'required' in placement ? Boolean(placement.required) : false,
})

const matches = (placement: LayoutPlacementV3, selector: LayoutPlacementSelector): boolean => {
  if (selector.placementId === undefined && selector.contract === undefined) return false
  return (selector.placementId === undefined || selector.placementId === placement.id) &&
    (selector.contract === undefined || selector.contract === placement.contract)
}

const validateRule = (condition: boolean, path: string, message: string): void => {
  if (!condition) throw migrationError('invalid-migration-output', path, message)
}

const applyZoneRenames = (
  schema: { zones: Record<string, LayoutPlacementV3[]> },
  rules: readonly LayoutZoneRename[],
  changes: LayoutChange[],
): void => {
  for (const [index, rule] of rules.entries()) {
    validateRule(rule.from.trim() !== '' && rule.to.trim() !== '' && rule.from !== rule.to, `rules.zones[${index}]`, 'zone rename must have distinct non-empty names')
    const source = schema.zones[rule.from]
    if (source === undefined) continue
    const target = schema.zones[rule.to]
    if (target !== undefined && rule.merge === undefined) {
      throw migrationError('zone-collision', `$.zones.${rule.to}`, `cannot rename zone "${rule.from}" because "${rule.to}" already exists`)
    }
    schema.zones[rule.to] = target === undefined
      ? source
      : rule.merge === 'prepend' ? [...source, ...target] : [...target, ...source]
    delete schema.zones[rule.from]
    changes.push({ code: 'renamed-zone', path: `$.zones.${rule.from}`, from: rule.from, to: rule.to })
  }
}

const applyPlacementChanges = (
  schema: { zones: Record<string, LayoutPlacementV3[]> },
  rules: LayoutMigrationRules,
  changes: LayoutChange[],
): void => {
  for (const [zoneId, placements] of Object.entries(schema.zones)) {
    const next: LayoutPlacementV3[] = []
    for (const placement of placements) {
      const removal = rules.removePlacements?.find((rule) => matches(placement, rule))
      if (removal) {
        if (placement.required) {
          throw migrationError('missing-required-replacement', `$.zones.${zoneId}.${placement.id}`, `required placement "${placement.id}" has no replacement`)
        }
        changes.push({ code: 'removed-placement', path: `$.zones.${zoneId}.${placement.id}`, from: placement.id })
        continue
      }

      const split = rules.splitPlacements?.find((rule) => matches(placement, rule))
      if (split) {
        validateRule(split.replacements.length > 0, 'rules.splitPlacements', `split for "${placement.id}" must provide replacements`)
        const replacements = split.replacements.map((replacement) => {
          validateRule(
            replacement.id.trim() !== '' && replacement.contract.trim() !== '' && Number.isInteger(replacement.contractVersion) && replacement.contractVersion > 0,
            `rules.splitPlacements.${replacement.id}`,
            'split replacement is incomplete',
          )
          return {
            id: replacement.id,
            contract: replacement.contract,
            contractVersion: replacement.contractVersion,
            ...(replacement.layout === undefined ? {} : { layout: { ...replacement.layout } }),
            required: replacement.required ?? placement.required,
          }
        })
        if (placement.required && !replacements.some((replacement) => replacement.required)) {
          throw migrationError('missing-required-replacement', `$.zones.${zoneId}.${placement.id}`, `split for required placement "${placement.id}" has no required replacement`)
        }
        next.push(...replacements)
        changes.push({ code: 'split-placement', path: `$.zones.${zoneId}.${placement.id}`, from: placement.id, to: replacements.map(({ id }) => id).join(',') })
        continue
      }

      const replacement = rules.replaceContracts?.find((rule) => matches(placement, rule))
      if (replacement) {
        validateRule(replacement.replacement.contract.trim() !== '' && Number.isInteger(replacement.replacement.contractVersion) && replacement.replacement.contractVersion > 0, 'rules.replaceContracts', 'contract replacement is incomplete')
        next.push({ ...placement, contract: replacement.replacement.contract, contractVersion: replacement.replacement.contractVersion })
        changes.push({ code: 'replaced-contract', path: `$.zones.${zoneId}.${placement.id}`, from: placement.contract, to: replacement.replacement.contract })
        continue
      }

      next.push(placement)
    }
    schema.zones[zoneId] = next
  }
}

const migrateEdge = (
  input: LayoutSchemaV1 | LayoutSchemaV2,
  rules: LayoutMigrationRules,
  target: 2 | 3,
): { readonly schema: LayoutSchemaV2 | LayoutSchemaV3; readonly changes: readonly LayoutChange[] } => {
  const schema: { page: string; schemaVersion: 2 | 3; zones: Record<string, LayoutPlacementV3[]> } = {
    page: input.page,
    schemaVersion: target,
    zones: Object.fromEntries(Object.entries(input.zones).map(([zoneId, placements]) => [zoneId, placements.map(clonePlacement)])),
  }
  const changes: LayoutChange[] = []
  applyZoneRenames(schema, rules.zones ?? [], changes)
  applyPlacementChanges(schema, rules, changes)
  return {
    schema: {
      ...schema,
      schemaVersion: target,
      zones: schema.zones,
    } as LayoutSchemaV2 | LayoutSchemaV3,
    changes,
  }
}

const validateMigrated = (schema: LayoutSchema, expectedVersion: 2 | 3): LayoutSchemaV2 | LayoutSchemaV3 => {
  try {
    const parsed = parseLayoutSchema(schema)
    if (parsed.schemaVersion !== expectedVersion) throw new Error(`expected schema version ${expectedVersion}`)
    return parsed as LayoutSchemaV2 | LayoutSchemaV3
  } catch (error) {
    throw migrationError('invalid-migration-output', '$', error instanceof Error ? error.message : 'migration output is invalid')
  }
}

const normalizeError = (error: unknown): LayoutMigrationError => {
  if (error && typeof error === 'object' && 'code' in error && 'path' in error && 'message' in error &&
    typeof error.code === 'string' && typeof error.path === 'string' && typeof error.message === 'string') {
    const code = ['invalid-json', 'invalid-schema', 'unsupported-version', 'zone-collision', 'missing-required-replacement', 'missing-required-placement', 'invalid-migration-output'].includes(error.code)
      ? error.code as LayoutMigrationErrorCode
      : 'invalid-migration-output'
    return { code, path: error.path, message: error.message }
  }
  return migrationError('invalid-migration-output', '$', error instanceof Error ? error.message : 'layout migration failed')
}

export function migrateLayoutSchema(input: unknown, options: LayoutMigrationOptions = {}): LayoutMigrationResult {
  const changes: LayoutChange[] = []
  let parsed: LayoutSchema
  try {
    parsed = typeof input === 'string' ? parseLayoutJson(input) : parseLayoutSchema(input)
  } catch (error) {
    const normalized = normalizeError(error)
    return { status: 'failed', original: input, error: normalized }
  }

  try {
    if (parsed.schemaVersion === 3) return { status: 'current', schema: cloneLayoutSchema(parsed) as LayoutSchemaV3, changes }
    const first = migrateEdge(parsed as LayoutSchemaV1 | LayoutSchemaV2, parsed.schemaVersion === 1 ? options.v1ToV2 ?? EMPTY_RULES : EMPTY_RULES, 2)
    changes.push(...first.changes)
    const v2 = validateMigrated(first.schema, 2) as LayoutSchemaV2
    const second = migrateEdge(v2, options.v2ToV3 ?? EMPTY_RULES, 3)
    changes.push(...second.changes)
    const v3 = validateMigrated(second.schema, 3) as LayoutSchemaV3
    return { status: 'migrated', schema: v3, changes }
  } catch (error) {
    return { status: 'failed', original: input, error: normalizeError(error) }
  }
}

export function loadLayoutSchema(input: unknown, fallback: LayoutSchemaV3, options: LayoutMigrationOptions = {}): LayoutLoadResult {
  const result = migrateLayoutSchema(input, options)
  if (result.status === 'failed') return { status: 'fallback', fallback, original: result.original, error: result.error }
  return result
}

export const parseLayoutForLoad = loadLayoutSchema
