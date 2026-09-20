export const LAYOUT_SCHEMA_VERSIONS = [1, 2, 3] as const
export const LAYOUT_SCHEMA_VERSION = 3 as const

export type LayoutSchemaVersion = (typeof LAYOUT_SCHEMA_VERSIONS)[number]

export type LayoutContractRef = {
  id: string
  version: number
}

export type LayoutComponentRef = {
  id: string
}

export type LayoutPlacementV1 = {
  id: string
  contract: LayoutContractRef
  component: LayoutComponentRef
}

export type LayoutPlacementV2 = LayoutPlacementV1 & {
  required?: boolean
}

export type LayoutPlacementV3 = LayoutPlacementV1 & {
  required: boolean
}

export type LayoutSchemaV1 = {
  page: string
  schemaVersion: 1
  zones: Record<string, LayoutPlacementV1[]>
}

export type LayoutSchemaV2 = {
  page: string
  schemaVersion: 2
  zones: Record<string, LayoutPlacementV2[]>
}

export type LayoutSchemaV3 = {
  page: string
  schemaVersion: 3
  zones: Record<string, LayoutPlacementV3[]>
}

export type LayoutSchema = LayoutSchemaV1 | LayoutSchemaV2 | LayoutSchemaV3

export type LayoutSchemaErrorCode =
  | 'invalid-schema'
  | 'unsupported-version'
  | 'invalid-json'

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
  | { success: true; data: LayoutSchema }
  | { success: false; error: LayoutSchemaValidationError }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const fail = (path: string, message: string): never => {
  throw new LayoutSchemaValidationError('invalid-schema', path, message)
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be an object')
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
}

const readNonEmptyString = (value: unknown, path: string): string => {
  if (!isNonEmptyString(value)) fail(path, 'must be a non-empty string')
  return value as string
}

const readPositiveInteger = (value: unknown, path: string): number => {
  if (!isPositiveInteger(value)) fail(path, 'must be a positive integer')
  return value as number
}

const readSchemaVersion = (value: unknown): LayoutSchemaVersion => {
  if (!isPositiveInteger(value) || !LAYOUT_SCHEMA_VERSIONS.includes(value as LayoutSchemaVersion)) {
    if (typeof value === 'number' && Number.isInteger(value) && value > Math.max(...LAYOUT_SCHEMA_VERSIONS)) {
      throw new LayoutSchemaValidationError('unsupported-version', '$.schemaVersion', `schema version ${value} is not supported`)
    }
    fail('$.schemaVersion', 'must be one of the supported schema versions')
  }
  return value as LayoutSchemaVersion
}

const assertKnownKeys = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'is not a supported field')
  }
}

const parseContract = (value: unknown, path: string): LayoutContractRef => {
  assertRecord(value, path)
  assertKnownKeys(value, ['id', 'version'], path)
  return { id: readNonEmptyString(value.id, `${path}.id`), version: readPositiveInteger(value.version, `${path}.version`) }
}

const parseComponent = (value: unknown, path: string): LayoutComponentRef => {
  assertRecord(value, path)
  assertKnownKeys(value, ['id'], path)
  return { id: readNonEmptyString(value.id, `${path}.id`) }
}

const parsePlacement = (
  value: unknown,
  path: string,
  version: LayoutSchemaVersion,
): LayoutPlacementV1 | LayoutPlacementV2 | LayoutPlacementV3 => {
  assertRecord(value, path)
  const keys = version === 1 ? ['id', 'contract', 'component'] : ['id', 'contract', 'component', 'required']
  assertKnownKeys(value, keys, path)
  const id = readNonEmptyString(value.id, `${path}.id`)
  if (version === 1) {
    if ('required' in value) fail(`${path}.required`, 'is not supported in schema version 1')
  } else if (version === 3 && !('required' in value)) {
    fail(`${path}.required`, 'is required in schema version 3')
  } else if ('required' in value && typeof value.required !== 'boolean') {
    fail(`${path}.required`, 'must be a boolean when provided')
  }

  const placement = {
    id,
    contract: parseContract(value.contract, `${path}.contract`),
    component: parseComponent(value.component, `${path}.component`),
  }
  if (version === 1) return placement
  return { ...placement, ...(value.required === undefined ? {} : { required: value.required }) }
}

const parseDocument = (input: unknown): LayoutSchema => {
  assertRecord(input, '$')
  assertKnownKeys(input, ['page', 'schemaVersion', 'zones'], '$')
  const page = readNonEmptyString(input.page, '$.page')
  const version = readSchemaVersion(input.schemaVersion)
  assertRecord(input.zones, '$.zones')
  const result: Record<string, LayoutPlacementV1[] | LayoutPlacementV2[] | LayoutPlacementV3[]> = {}
  const placementIds = new Set<string>()

  for (const [zoneId, rawPlacements] of Object.entries(input.zones)) {
    if (!isNonEmptyString(zoneId)) fail('$.zones', 'zone ids must be non-empty strings')
    assertArray(rawPlacements, `$.zones.${zoneId}`)
    const placements = rawPlacements.map((rawPlacement, index) => {
      const placement = parsePlacement(rawPlacement, `$.zones.${zoneId}[${index}]`, version)
      if (placementIds.has(placement.id)) fail(`$.zones.${zoneId}[${index}].id`, `duplicates placement id "${placement.id}"`)
      placementIds.add(placement.id)
      return placement
    })
    result[zoneId] = placements
  }

  if (version === 1) return { page, schemaVersion: 1, zones: result as Record<string, LayoutPlacementV1[]> }
  if (version === 2) return { page, schemaVersion: 2, zones: result as Record<string, LayoutPlacementV2[]> }
  return { page, schemaVersion: 3, zones: result as Record<string, LayoutPlacementV3[]> }
}

export function parseLayoutSchema(input: unknown): LayoutSchema {
  return parseDocument(input)
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
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new LayoutSchemaValidationError('invalid-json', '$', 'layout JSON is not valid JSON')
  }
  return parseLayoutSchema(value)
}

export function serializeLayoutSchema(schema: LayoutSchema): string {
  parseLayoutSchema(schema)
  return JSON.stringify(schema)
}

export function cloneLayoutSchema(schema: LayoutSchema): LayoutSchema {
  return JSON.parse(JSON.stringify(schema)) as LayoutSchema
}
