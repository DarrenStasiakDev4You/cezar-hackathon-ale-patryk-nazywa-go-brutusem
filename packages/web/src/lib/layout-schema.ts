import {
  parseLayoutSchema as parseV1LayoutSchema,
  type LayoutPlacement as LayoutPlacementV1,
  type LayoutPlacementLayout,
  type LayoutSchema as LayoutSchemaV1,
} from '@open-mercato/cezar-extension-api'

export const LAYOUT_SCHEMA_VERSIONS = [1, 2, 3] as const
export const LAYOUT_SCHEMA_VERSION = 3 as const

export type LayoutSchemaVersion = (typeof LAYOUT_SCHEMA_VERSIONS)[number]
export type { LayoutPlacementLayout, LayoutPlacementV1, LayoutSchemaV1 }

export type LayoutPlacementV2 = LayoutPlacementV1 & { readonly required?: boolean }
export type LayoutPlacementV3 = LayoutPlacementV1 & { readonly required: boolean }

export type LayoutSchemaV2 = {
  readonly page: string
  readonly schemaVersion: 2
  readonly zones: Readonly<Record<string, readonly LayoutPlacementV2[]>>
}

export type LayoutSchemaV3 = {
  readonly page: string
  readonly schemaVersion: 3
  readonly zones: Readonly<Record<string, readonly LayoutPlacementV3[]>>
}

export type LayoutSchema = LayoutSchemaV1 | LayoutSchemaV2 | LayoutSchemaV3
export type LayoutSchemaErrorCode = 'invalid-schema' | 'unsupported-version' | 'invalid-json'

export class LayoutSchemaValidationError extends Error {
  readonly code: LayoutSchemaErrorCode
  readonly path: string

  constructor(code: LayoutSchemaErrorCode, path: string, message: string) {
    super(message)
    this.name = 'LayoutSchemaValidationError'
    this.code = code
    this.path = path
  }
}

export type LayoutParseResult =
  | { readonly success: true; readonly data: LayoutSchema }
  | { readonly success: false; readonly error: LayoutSchemaValidationError }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

const fail = (path: string, message: string): never => {
  throw new LayoutSchemaValidationError('invalid-schema', path, message)
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be an object')
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'is not a supported field')
}

function readString(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) fail(path, 'must be a non-empty string')
  return value as string
}

function readPositiveInteger(value: unknown, path: string): number {
  if (!isPositiveInteger(value)) fail(path, 'must be a positive integer')
  return value as number
}

function readVersion(value: unknown): LayoutSchemaVersion {
  if (value === 1 || value === 2 || value === 3) return value
  if (typeof value === 'number' && Number.isInteger(value) && value > 3) {
    throw new LayoutSchemaValidationError('unsupported-version', '$.schemaVersion', `schema version ${value} is not supported`)
  }
  return fail('$.schemaVersion', 'must be one of the supported schema versions')
}

function parseLayout(value: unknown, path: string): LayoutPlacementLayout | undefined {
  if (value === undefined) return undefined
  assertRecord(value, path)
  assertKnownKeys(value, ['collapsed', 'density', 'width'], path)
  const layout: { collapsed?: boolean; density?: LayoutPlacementLayout['density']; width?: LayoutPlacementLayout['width'] } = {}
  if (value.collapsed !== undefined) {
    if (typeof value.collapsed !== 'boolean') fail(`${path}.collapsed`, 'must be a boolean')
    layout.collapsed = value.collapsed as boolean
  }
  if (value.density !== undefined) {
    if (value.density !== 'comfortable' && value.density !== 'compact') fail(`${path}.density`, 'must be comfortable or compact')
    layout.density = value.density as LayoutPlacementLayout['density']
  }
  if (value.width !== undefined) {
    if (value.width !== 'auto' && value.width !== 'small' && value.width !== 'medium' && value.width !== 'large') {
      fail(`${path}.width`, 'must be auto, small, medium or large')
    }
    layout.width = value.width as LayoutPlacementLayout['width']
  }
  return layout
}

function parsePlacement(value: unknown, path: string, version: 2 | 3): LayoutPlacementV2 | LayoutPlacementV3 {
  assertRecord(value, path)
  assertKnownKeys(value, ['id', 'contract', 'contractVersion', 'layout', 'required'], path)
  const layout = parseLayout(value.layout, `${path}.layout`)
  const placement = {
    id: readString(value.id, `${path}.id`),
    contract: readString(value.contract, `${path}.contract`),
    contractVersion: readPositiveInteger(value.contractVersion, `${path}.contractVersion`),
    ...(layout === undefined ? {} : { layout }),
  }
  const required = value.required
  if (version === 3 && typeof required !== 'boolean') fail(`${path}.required`, 'must be a boolean')
  if (required !== undefined && typeof required !== 'boolean') fail(`${path}.required`, 'must be a boolean')
  return version === 3
    ? { ...placement, required: required as boolean }
    : { ...placement, ...(required === undefined ? {} : { required: required as boolean }) }
}

function parseVersionedSchema(input: unknown, version: 2 | 3): LayoutSchemaV2 | LayoutSchemaV3 {
  assertRecord(input, '$')
  assertKnownKeys(input, ['page', 'schemaVersion', 'zones'], '$')
  if (input.schemaVersion !== version) fail('$.schemaVersion', `expected schema version ${version}`)
  const page = readString(input.page, '$.page')
  const rawZones = input.zones
  assertRecord(rawZones, '$.zones')
  const zones: Record<string, readonly LayoutPlacementV2[] | readonly LayoutPlacementV3[]> = {}
  const placementIds = new Set<string>()
  for (const [zoneId, rawZone] of Object.entries(rawZones)) {
    if (!isNonEmptyString(zoneId)) fail('$.zones', 'zone ids must be non-empty strings')
    const zoneValues: unknown[] = Array.isArray(rawZone) ? rawZone : fail(`$.zones.${zoneId}`, 'must be an array')
    const zone = zoneValues.map((rawPlacement: unknown, index: number) => {
      const placement = parsePlacement(rawPlacement, `$.zones.${zoneId}[${index}]`, version)
      if (placementIds.has(placement.id)) fail(`$.zones.${zoneId}[${index}].id`, `duplicates placement id "${placement.id}"`)
      placementIds.add(placement.id)
      return placement
    })
    zones[zoneId] = zone
  }
  return version === 2
    ? { page, schemaVersion: 2, zones: zones as Record<string, readonly LayoutPlacementV2[]> }
    : { page, schemaVersion: 3, zones: zones as Record<string, readonly LayoutPlacementV3[]> }
}

export function parseLayoutSchema(input: unknown): LayoutSchema {
  assertRecord(input, '$')
  const version = readVersion(input.schemaVersion)
  if (version === 1) {
    try {
      return parseV1LayoutSchema(input)
    } catch (error) {
      const firstIssue = error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues) ? error.issues[0] : undefined
      const path = firstIssue && typeof firstIssue === 'object' && 'path' in firstIssue && typeof firstIssue.path === 'string'
        ? `$.${firstIssue.path}`
        : '$'
      throw new LayoutSchemaValidationError('invalid-schema', path, error instanceof Error ? error.message : 'layout schema is invalid')
    }
  }
  return parseVersionedSchema(input, version)
}

export function tryParseLayoutSchema(input: unknown): LayoutParseResult {
  try {
    return { success: true, data: parseLayoutSchema(input) }
  } catch (error) {
    if (error instanceof LayoutSchemaValidationError) return { success: false, error }
    throw error
  }
}

export function parseLayoutJson(text: string): LayoutSchema {
  try {
    return parseLayoutSchema(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new LayoutSchemaValidationError('invalid-json', '$', 'layout JSON is not valid JSON')
    throw error
  }
}

export function serializeLayoutSchema(schema: LayoutSchema): string {
  parseLayoutSchema(schema)
  return JSON.stringify(schema)
}

export function cloneLayoutSchema(schema: LayoutSchema): LayoutSchema {
  return JSON.parse(JSON.stringify(schema)) as LayoutSchema
}
