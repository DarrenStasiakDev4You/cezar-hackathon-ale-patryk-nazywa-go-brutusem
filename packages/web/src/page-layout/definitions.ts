import { isValidContributionId, type ContributionId, type ComponentContract } from '@open-mercato/cezar-extension-api'

import type { AnyComponentContract } from '@/component-registry/registry'

export type PageId = ContributionId
export type ZoneId = ContributionId
export type PlacementId = ContributionId
export type PageComponentContract = AnyComponentContract

export interface ZoneLayout {
  readonly order?: number
  readonly sizing?: 'content' | 'fill'
  readonly sticky?: 'top' | 'bottom'
  readonly minBlockSize?: number
}

export interface ZoneDefinition {
  readonly id: ZoneId
  /** Semantic placement category, not an implementation selector. */
  readonly placement: PlacementId
  /** Omitted means every valid contract for this placement is admitted. */
  readonly accepts?: readonly PageComponentContract[]
  readonly cardinality: 'single' | 'many'
  readonly required: boolean
  readonly layout?: ZoneLayout
}

export interface PageDefinition {
  readonly id: PageId
  readonly version: number
  readonly zones: readonly ZoneDefinition[]
}

export interface ZoneContent {
  readonly key: string
  readonly placement: PlacementId
  readonly contract: PageComponentContract
  readonly props: object
}

export interface PageContent {
  readonly pageId: PageId
  readonly zones: Readonly<Record<ZoneId, readonly ZoneContent[]>>
}

export type PageContentIssue =
  | { readonly code: 'unknown-page'; readonly pageId: PageId }
  | { readonly code: 'unknown-zone'; readonly pageId: PageId; readonly zoneId: ZoneId }
  | { readonly code: 'placement-not-accepted'; readonly zoneId: ZoneId; readonly placement: PlacementId }
  | {
      readonly code: 'contract-not-accepted'
      readonly zoneId: ZoneId
      readonly contractId: string
      readonly version: number
    }
  | {
      readonly code: 'zone-not-allowed'
      readonly zoneId: ZoneId
      readonly contractId: string
      readonly version: number
    }
  | { readonly code: 'cardinality-exceeded'; readonly zoneId: ZoneId }
  | { readonly code: 'required-zone-empty'; readonly zoneId: ZoneId }
  | { readonly code: 'invalid-content'; readonly zoneId: ZoneId }

export class PageLayoutDefinitionError extends Error {
  override readonly name = 'PageLayoutDefinitionError' as const
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid page layout definition: ${issues.join('; ')}`)
    this.issues = Object.freeze([...issues])
  }
}

/**
 * Creates the immutable page definition stored by the registry. Keeping validation here means
 * catalog declarations and definitions supplied by future adapters share exactly the same rules.
 */
export function definePage(definition: PageDefinition): PageDefinition {
  const issues = validateDefinition(definition)
  if (issues.length > 0) throw new PageLayoutDefinitionError(issues)
  return freezeDefinition(definition)
}

/** Used by the registry as well, because callers can provide structurally typed definitions. */
export function normalizePageDefinition(definition: PageDefinition): PageDefinition {
  const issues = validateDefinition(definition)
  if (issues.length > 0) throw new PageLayoutDefinitionError(issues)
  return freezeDefinition(definition)
}

function validateDefinition(definition: PageDefinition): string[] {
  const issues: string[] = []
  if (!isRecord(definition)) return ['definition must be an object']
  if (!isValidContributionId(definition.id)) issues.push('id must be a valid contribution id')
  if (!isPositiveInteger(definition.version)) issues.push('version must be a positive integer')
  if (!Array.isArray(definition.zones) || definition.zones.length === 0) {
    issues.push('zones must be a non-empty array')
    return issues
  }

  const zoneIds = new Set<string>()
  definition.zones.forEach((zone, index) => {
    const path = `zones[${index}]`
    if (!isRecord(zone)) {
      issues.push(`${path} must be an object`)
      return
    }
    const zoneId = typeof zone.id === 'string' ? zone.id : ''
    if (!isValidContributionId(zoneId)) issues.push(`${path}.id must be a valid contribution id`)
    if (zoneIds.has(zoneId)) issues.push(`${path}.id duplicates another zone`)
    zoneIds.add(zoneId)
    if (typeof zone.placement !== 'string' || !isValidContributionId(zone.placement)) {
      issues.push(`${path}.placement must be a valid contribution id`)
    }
    if (zone.cardinality !== 'single' && zone.cardinality !== 'many') {
      issues.push(`${path}.cardinality must be "single" or "many"`)
    }
    if (typeof zone.required !== 'boolean') issues.push(`${path}.required must be a boolean`)
    if (zone.accepts !== undefined && !Array.isArray(zone.accepts)) {
      issues.push(`${path}.accepts must be an array when provided`)
    } else if (zone.accepts !== undefined) {
      const contracts = new Set<string>()
      zone.accepts.forEach((contract, contractIndex) => {
        const contractPath = `${path}.accepts[${contractIndex}]`
        if (!isComponentContract(contract)) {
          issues.push(`${contractPath} must be a component contract`)
          return
        }
        const key = `${contract.id}@${contract.version}`
        if (contracts.has(key)) issues.push(`${contractPath} duplicates ${key}`)
        contracts.add(key)
      })
    }
    validateZoneLayout(zone.layout, path, issues)
  })
  return issues
}

function validateZoneLayout(layout: unknown, path: string, issues: string[]): void {
  if (layout === undefined) return
  if (!isRecord(layout)) {
    issues.push(`${path}.layout must be an object`)
    return
  }
  if (layout.order !== undefined && (typeof layout.order !== 'number' || !Number.isInteger(layout.order) || layout.order < 0)) {
    issues.push(`${path}.layout.order must be a non-negative integer`)
  }
  if (layout.sizing !== undefined && layout.sizing !== 'content' && layout.sizing !== 'fill') {
    issues.push(`${path}.layout.sizing must be "content" or "fill"`)
  }
  if (layout.sticky !== undefined && layout.sticky !== 'top' && layout.sticky !== 'bottom') {
    issues.push(`${path}.layout.sticky must be "top" or "bottom"`)
  }
  if (
    layout.minBlockSize !== undefined &&
    (typeof layout.minBlockSize !== 'number' ||
      !Number.isInteger(layout.minBlockSize) ||
      layout.minBlockSize < 0 ||
      layout.minBlockSize > 2048)
  ) {
    issues.push(`${path}.layout.minBlockSize must be an integer from 0 to 2048`)
  }
}

function freezeDefinition(definition: PageDefinition): PageDefinition {
  const zones = definition.zones.map((zone) => {
    const layout = zone.layout === undefined ? undefined : Object.freeze({ ...zone.layout })
    return Object.freeze({
      id: zone.id,
      placement: zone.placement,
      ...(zone.accepts === undefined ? {} : { accepts: Object.freeze([...zone.accepts]) }),
      cardinality: zone.cardinality,
      required: zone.required,
      ...(layout === undefined ? {} : { layout }),
    })
  })
  return Object.freeze({ id: definition.id, version: definition.version, zones: Object.freeze(zones) })
}

function isComponentContract(value: unknown): value is PageComponentContract {
  if (!isRecord(value)) return false
  return value.kind === 'component' && typeof value.id === 'string' && isValidContributionId(value.id) && isPositiveInteger(value.version)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Keep the exported contract type useful to callers without exposing the phantom props function.
export type { ComponentContract }
