import {
  cloneLayoutSchema,
  parseLayoutSchema,
  type LayoutContractRef,
  type LayoutPlacementV1,
  type LayoutPlacementV2,
  type LayoutPlacementV3,
  type LayoutSchema,
  type LayoutSchemaV1,
  type LayoutSchemaV2,
  type LayoutSchemaV3,
} from './layout-schema'

export type LayoutChangeCode =
  | 'renamed-zone'
  | 'removed-placement'
  | 'split-placement'
  | 'replaced-component'

export type LayoutChange = {
  code: LayoutChangeCode
  path: string
  from?: string
  to?: string
}

export type LayoutMigrationErrorCode =
  | 'invalid-schema'
  | 'unsupported-version'
  | 'zone-collision'
  | 'missing-required-replacement'
  | 'invalid-migration-output'

export type LayoutMigrationError = {
  code: LayoutMigrationErrorCode
  path: string
  message: string
}

export type LayoutPlacementSpec = {
  id: string
  contract: LayoutContractRef
  component: { id: string }
  required?: boolean
}

export type LayoutPlacementSelector = {
  placementId?: string
  componentId?: string
}

export type LayoutZoneRename = LayoutPlacementSelector & {
  from: string
  to: string
  merge?: 'append' | 'prepend'
}

export type LayoutPlacementRemoval = LayoutPlacementSelector

export type LayoutPlacementSplit = LayoutPlacementSelector & {
  replacements: readonly LayoutPlacementSpec[]
}

export type LayoutComponentReplacement = LayoutPlacementSelector & {
  contract?: LayoutContractRef
  component: { id: string }
}

export type LayoutMigrationRules = {
  readonly zones?: readonly LayoutZoneRename[]
  readonly removePlacements?: readonly LayoutPlacementRemoval[]
  readonly splitPlacements?: readonly LayoutPlacementSplit[]
  readonly replaceComponents?: readonly LayoutComponentReplacement[]
}

export type LayoutMigrationOptions = {
  readonly v1ToV2?: LayoutMigrationRules
  readonly v2ToV3?: LayoutMigrationRules
}

export type LayoutLoadResult =
  | { status: 'current' | 'migrated'; schema: LayoutSchemaV3; changes: readonly LayoutChange[] }
  | { status: 'fallback'; fallback: LayoutSchemaV3; error: LayoutMigrationError; original: unknown }

const EMPTY_RULES: LayoutMigrationRules = Object.freeze({})

const clonePlacement = (placement: LayoutPlacementV1 | LayoutPlacementV2 | LayoutPlacementV3): LayoutPlacementV3 => ({
  id: placement.id,
  contract: { ...placement.contract },
  component: { ...placement.component },
  required: 'required' in placement ? Boolean(placement.required) : false,
})

const matches = (placement: LayoutPlacementV3, selector: LayoutPlacementSelector): boolean => {
  const hasSelector = selector.placementId !== undefined || selector.componentId !== undefined
  if (!hasSelector) return false
  return (selector.placementId === undefined || selector.placementId === placement.id) &&
    (selector.componentId === undefined || selector.componentId === placement.component.id)
}

const migrationError = (code: LayoutMigrationErrorCode, path: string, message: string): LayoutMigrationError => ({ code, path, message })

const invalidRule = (path: string, message: string): never => {
  throw migrationError('invalid-migration-output', path, message)
}

const applyZoneRenames = (
  schema: { zones: Record<string, LayoutPlacementV3[]> },
  rules: readonly LayoutZoneRename[],
  changes: LayoutChange[],
): void => {
  for (const [index, rule] of rules.entries()) {
    if (!rule.from || !rule.to || rule.from === rule.to) invalidRule(`rules.zones[${index}]`, 'zone rename must have distinct non-empty names')
    const source = schema.zones[rule.from]
    if (source === undefined) continue
    const target = schema.zones[rule.to]
    if (target !== undefined && rule.merge === undefined) {
      throw migrationError('zone-collision', `$.zones.${rule.to}`, `cannot rename zone "${rule.from}" because "${rule.to}" already exists`)
    }
    if (target === undefined) schema.zones[rule.to] = source
    else schema.zones[rule.to] = rule.merge === 'prepend' ? [...source, ...target] : [...target, ...source]
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
          throw migrationError('missing-required-replacement', `$.zones.${zoneId}`, `required placement "${placement.id}" has no replacement`)
        }
        changes.push({ code: 'removed-placement', path: `$.zones.${zoneId}.${placement.id}`, from: placement.id })
        continue
      }

      const split = rules.splitPlacements?.find((rule) => matches(placement, rule))
      if (split) {
        if (split.replacements.length === 0 || split.replacements.some((replacement) => !replacement.id || !replacement.contract?.id || !replacement.component?.id)) {
          invalidRule(`rules.splitPlacements`, `split for "${placement.id}" must provide complete replacements`)
        }
        const replacements = split.replacements.map((replacement) => ({
          id: replacement.id,
          contract: { ...replacement.contract },
          component: { ...replacement.component },
          required: replacement.required ?? placement.required,
        }))
        if (placement.required && !replacements.some((replacement) => replacement.required)) {
          throw migrationError('missing-required-replacement', `$.zones.${zoneId}.${placement.id}`, `split for required placement "${placement.id}" has no required replacement`)
        }
        next.push(...replacements)
        changes.push({ code: 'split-placement', path: `$.zones.${zoneId}.${placement.id}`, from: placement.id, to: replacements.map((item) => item.id).join(',') })
        continue
      }

      const replacement = rules.replaceComponents?.find((rule) => matches(placement, rule))
      if (replacement) {
        const nextPlacement: LayoutPlacementV3 = {
          ...placement,
          contract: replacement.contract ? { ...replacement.contract } : { ...placement.contract },
          component: { ...replacement.component },
        }
        next.push(nextPlacement)
        changes.push({ code: 'replaced-component', path: `$.zones.${zoneId}.${placement.id}`, from: placement.component.id, to: nextPlacement.component.id })
        continue
      }

      next.push(placement)
    }
    schema.zones[zoneId] = next
  }
}

const migrateEdge = (input: LayoutSchemaV1 | LayoutSchemaV2, rules: LayoutMigrationRules, target: 2 | 3): { schema: LayoutSchemaV2 | LayoutSchemaV3; changes: LayoutChange[] } => {
  const schema: { page: string; schemaVersion: 2 | 3; zones: Record<string, LayoutPlacementV3[]> } = {
    page: input.page,
    schemaVersion: target,
    zones: Object.fromEntries(Object.entries(input.zones).map(([zoneId, placements]) => [zoneId, placements.map(clonePlacement)])),
  }
  const changes: LayoutChange[] = []
  applyZoneRenames(schema, rules.zones ?? [], changes)
  applyPlacementChanges(schema, rules, changes)
  if (target === 2) {
    return { schema: { ...schema, schemaVersion: 2, zones: schema.zones }, changes }
  }
  return { schema: { ...schema, schemaVersion: 3, zones: schema.zones }, changes }
}

function validateMigrated(schema: LayoutSchema, expectedVersion: 2): LayoutSchemaV2
function validateMigrated(schema: LayoutSchema, expectedVersion: 3): LayoutSchemaV3
function validateMigrated(schema: LayoutSchema, expectedVersion: 2 | 3): LayoutSchemaV2 | LayoutSchemaV3 {
  try {
    const parsed = parseLayoutSchema(schema)
    if (parsed.schemaVersion !== expectedVersion) throw new Error(`expected schema version ${expectedVersion}`)
    if (expectedVersion === 2) return parsed as LayoutSchemaV2
    return parsed as LayoutSchemaV3
  } catch (error) {
    const message = error instanceof Error ? error.message : 'migration output is invalid'
    throw migrationError('invalid-migration-output', '$', message)
  }
}

const toV3 = (schema: LayoutSchemaV2): LayoutSchemaV3 => ({
  page: schema.page,
  schemaVersion: 3,
  zones: Object.fromEntries(Object.entries(schema.zones).map(([zoneId, placements]) => [zoneId, placements.map(clonePlacement)])),
})

export function migrateLayoutSchema(
  input: unknown,
  fallback: LayoutSchemaV3,
  options: LayoutMigrationOptions = {},
): LayoutLoadResult {
  const changes: LayoutChange[] = []
  let parsed: LayoutSchema
  try {
    parsed = parseLayoutSchema(input)
  } catch (error) {
    const code = error instanceof Error && 'code' in error && error.code === 'unsupported-version'
      ? 'unsupported-version'
      : 'invalid-schema'
    const path = error instanceof Error && 'path' in error && typeof error.path === 'string' ? error.path : '$'
    return { status: 'fallback', fallback, original: input, error: migrationError(code, path, error instanceof Error ? error.message : 'layout schema is invalid') }
  }

  try {
    if (parsed.schemaVersion === 3) return { status: 'current', schema: cloneLayoutSchema(parsed) as LayoutSchemaV3, changes }
    let v2: LayoutSchemaV2
    if (parsed.schemaVersion === 1) {
      const edge = migrateEdge(parsed, options.v1ToV2 ?? EMPTY_RULES, 2)
      changes.push(...edge.changes)
      v2 = validateMigrated(edge.schema, 2)
    } else {
      v2 = parsed as LayoutSchemaV2
    }
    const v3Edge = migrateEdge(v2, options.v2ToV3 ?? EMPTY_RULES, 3)
    changes.push(...v3Edge.changes)
    const schema = validateMigrated(v3Edge.schema, 3)
    return { status: 'migrated', schema: schema as LayoutSchemaV3, changes }
  } catch (error) {
    const normalized = error as LayoutMigrationError
    return {
      status: 'fallback',
      fallback,
      original: input,
      error: normalized.code ? normalized : migrationError('invalid-migration-output', '$', 'layout migration failed'),
    }
  }
}

export const parseLayoutForLoad = migrateLayoutSchema

/**
 * Load boundary for a persisted layout. A caller supplies the current core/default layout; a
 * failed migration returns it without throwing and keeps the original input for a later retry.
 */
export const loadLayoutSchema = migrateLayoutSchema
