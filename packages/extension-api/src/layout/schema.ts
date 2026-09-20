/** The only layout document structure supported by this version of the extension API. */
export const LAYOUT_SCHEMA_VERSION = 1 as const

export type LayoutPlacementLayout = {
  readonly collapsed?: boolean
  readonly density?: 'comfortable' | 'compact'
  readonly width?: 'auto' | 'small' | 'medium' | 'large'
}

export type LayoutPlacement = {
  readonly id: string
  readonly contract: string
  readonly contractVersion: number
  readonly layout?: LayoutPlacementLayout
}

export type LayoutZone = readonly LayoutPlacement[]

export type LayoutSchema = {
  readonly page: string
  readonly schemaVersion: typeof LAYOUT_SCHEMA_VERSION
  readonly zones: Readonly<Record<string, LayoutZone>>
}

export type LayoutSchemaErrorCode = 'invalid-json' | 'invalid-schema' | 'unsupported-version'

export interface LayoutSchemaIssue {
  readonly path: string
  readonly message: string
}

/** A local, typed failure from parsing a layout document. */
export class LayoutSchemaError extends Error {
  override readonly name = 'LayoutSchemaError' as const
  readonly code: LayoutSchemaErrorCode
  readonly issues: readonly LayoutSchemaIssue[]

  constructor(code: LayoutSchemaErrorCode, message: string, issues: readonly LayoutSchemaIssue[] = []) {
    super(message)
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

const ROOT_KEYS = new Set(['page', 'schemaVersion', 'zones'])
const PLACEMENT_KEYS = new Set(['id', 'contract', 'contractVersion', 'layout'])
const LAYOUT_KEYS = new Set(['collapsed', 'density', 'width'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function display(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return typeof value
}

function addUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: LayoutSchemaIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path: path ? `${path}.${key}` : key, message: 'is not supported in layout schema version 1' })
  }
}

function nonEmptyString(value: unknown, path: string, issues: LayoutSchemaIssue[]): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path, message: 'must be a non-empty string' })
    return false
  }
  return true
}

function parseLayout(value: unknown, path: string, issues: LayoutSchemaIssue[]): LayoutPlacementLayout | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object when present' })
    return undefined
  }

  addUnknownKeys(value, LAYOUT_KEYS, path, issues)
  const layout: { collapsed?: boolean; density?: LayoutPlacementLayout['density']; width?: LayoutPlacementLayout['width'] } = {}
  if (value.collapsed !== undefined) {
    if (typeof value.collapsed === 'boolean') layout.collapsed = value.collapsed
    else issues.push({ path: `${path}.collapsed`, message: 'must be a boolean' })
  }
  if (value.density !== undefined) {
    if (value.density === 'comfortable' || value.density === 'compact') layout.density = value.density
    else issues.push({ path: `${path}.density`, message: 'must be `comfortable` or `compact`' })
  }
  if (value.width !== undefined) {
    if (value.width === 'auto' || value.width === 'small' || value.width === 'medium' || value.width === 'large') layout.width = value.width
    else issues.push({ path: `${path}.width`, message: 'must be `auto`, `small`, `medium` or `large`' })
  }
  return layout
}

function parsePlacement(value: unknown, path: string, issues: LayoutSchemaIssue[]): LayoutPlacement | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' })
    return undefined
  }

  addUnknownKeys(value, PLACEMENT_KEYS, path, issues)
  const idValue = value.id
  const contractValue = value.contract
  const id = nonEmptyString(idValue, `${path}.id`, issues) ? idValue : ''
  const contract = nonEmptyString(contractValue, `${path}.contract`, issues) ? contractValue : ''
  const contractVersion = value.contractVersion
  if (typeof contractVersion !== 'number' || !Number.isInteger(contractVersion) || contractVersion <= 0) {
    issues.push({ path: `${path}.contractVersion`, message: 'must be a positive integer' })
    return undefined
  }
  const layout = parseLayout(value.layout, `${path}.layout`, issues)

  if (!id || !contract) return undefined
  return layout === undefined ? { id, contract, contractVersion } : { id, contract, contractVersion, layout }
}

function parseSchema(value: unknown): LayoutSchema {
  if (!isRecord(value)) {
    throw new LayoutSchemaError('invalid-schema', 'layout schema must be an object', [{ path: '', message: 'must be an object' }])
  }

  const issues: LayoutSchemaIssue[] = []
  addUnknownKeys(value, ROOT_KEYS, '', issues)
  const pageValue = value.page
  const page = nonEmptyString(pageValue, 'page', issues) ? pageValue : ''
  if (value.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message:
        value.schemaVersion === undefined
          ? 'must be the supported layout schema version 1'
          : `unsupported layout schema version ${display(value.schemaVersion)}`,
    })
  }
  if (!isRecord(value.zones)) {
    issues.push({ path: 'zones', message: 'must be an object of named placement arrays' })
  }

  const zones: Record<string, LayoutZone> = {}
  const placementIds = new Map<string, string>()
  if (isRecord(value.zones)) {
    for (const zoneName of Object.keys(value.zones)) {
      const zonePath = `zones.${zoneName}`
      const zone = value.zones[zoneName]
      if (!nonEmptyString(zoneName, zonePath, issues)) continue
      if (!Array.isArray(zone)) {
        issues.push({ path: zonePath, message: 'must be an array of placements' })
        continue
      }
      const placements: LayoutPlacement[] = []
      zone.forEach((candidate, index) => {
        const placementPath = `${zonePath}[${index}]`
        const placement = parsePlacement(candidate, placementPath, issues)
        if (placement === undefined) return
        const previousPath = placementIds.get(placement.id)
        if (previousPath !== undefined) {
          issues.push({ path: `${placementPath}.id`, message: `must be unique — it repeats ${previousPath}.id` })
        } else {
          placementIds.set(placement.id, placementPath)
        }
        placements.push(placement)
      })
      Object.defineProperty(zones, zoneName, { value: placements, enumerable: true, configurable: true, writable: true })
    }
  }

  if (issues.length > 0) {
    const code: LayoutSchemaErrorCode = value.schemaVersion === undefined || value.schemaVersion === LAYOUT_SCHEMA_VERSION ? 'invalid-schema' : 'unsupported-version'
    throw new LayoutSchemaError(code, issues.map(({ path, message }) => (path ? `${path} ${message}` : message)).join('; '), issues)
  }

  return { page, schemaVersion: LAYOUT_SCHEMA_VERSION, zones }
}

/** Validate an unknown JSON value and return a fresh, plain-data layout model. */
export function parseLayoutSchema(value: unknown): LayoutSchema {
  try {
    return parseSchema(value)
  } catch (error) {
    if (error instanceof LayoutSchemaError) throw error
    throw new LayoutSchemaError('invalid-schema', 'layout schema must be readable')
  }
}

/** Parse JSON text and distinguish syntax errors from schema errors. */
export function parseLayoutJson(json: string): LayoutSchema {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch {
    throw new LayoutSchemaError('invalid-json', 'layout JSON is not valid JSON', [{ path: '', message: 'invalid JSON' }])
  }
  return parseLayoutSchema(value)
}

/** Serialize a valid layout using the v1 field order and preserving zone/placement order. */
export function serializeLayoutSchema(schema: LayoutSchema): string {
  return JSON.stringify(parseLayoutSchema(schema))
}
