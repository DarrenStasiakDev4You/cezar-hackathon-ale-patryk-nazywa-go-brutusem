import type {
  PageComponentContract,
  PageContent,
  PageDefinition,
  ZoneContent,
  ZoneDefinition,
  ZoneId,
} from './definitions'

export type LayoutOperation =
  | { readonly kind: 'move'; readonly key: string; readonly fromZone: ZoneId; readonly toZone: ZoneId }
  | { readonly kind: 'remove'; readonly key: string; readonly zone: ZoneId }
  | { readonly kind: 'replace'; readonly key: string; readonly zone: ZoneId; readonly contract: PageComponentContract }

export type LayoutConstraintIssue =
  | { readonly code: 'not-movable'; readonly key: string; readonly zone: ZoneId }
  | { readonly code: 'zone-not-allowed'; readonly key: string; readonly zone: ZoneId }
  | { readonly code: 'not-removable'; readonly key: string; readonly zone: ZoneId }
  | { readonly code: 'required-component'; readonly key: string; readonly zone: ZoneId }
  | { readonly code: 'not-replaceable'; readonly key: string; readonly zone: ZoneId }
  | { readonly code: 'contract-not-accepted'; readonly key: string; readonly zone: ZoneId }

export type LayoutOperationResult =
  | { readonly applied: true; readonly snapshot: readonly unknown[] }
  | { readonly applied: false; readonly issues: readonly LayoutConstraintIssue[] }

export interface LayoutConstraintPolicy {
  readonly movable: boolean
  readonly removable: boolean
  readonly replaceable: boolean
  readonly allowedZones?: readonly ZoneId[]
  readonly category?: string
}

const EMPTY_ISSUES: readonly LayoutConstraintIssue[] = Object.freeze([])

export function normalizeLayoutPolicy(contract: PageComponentContract): LayoutConstraintPolicy {
  const allowedZones = contract.allowedZones === undefined ? undefined : Object.freeze([...contract.allowedZones])
  return Object.freeze({
    movable: contract.movable === true,
    removable: contract.removable === true,
    replaceable: contract.replaceable !== false,
    ...(allowedZones === undefined ? {} : { allowedZones }),
    ...(contract.category === undefined ? {} : { category: contract.category }),
  })
}

/** Shared admission predicate used by content validation, rendering and edit-mode callers. */
export function zoneAdmissionIssue(
  zone: ZoneDefinition,
  item: Pick<ZoneContent, 'placement' | 'contract'>,
): 'placement-not-accepted' | 'contract-not-accepted' | 'zone-not-allowed' | null {
  if (item.placement !== zone.placement) return 'placement-not-accepted'
  return contractAdmissionIssue(zone, item.contract)
}

export function contractAdmissionIssue(
  zone: ZoneDefinition,
  contract: PageComponentContract,
): 'contract-not-accepted' | 'zone-not-allowed' | null {
  const policy = normalizeLayoutPolicy(contract)
  if (policy.allowedZones !== undefined && !policy.allowedZones.includes(zone.id)) return 'zone-not-allowed'
  if (zone.accepts !== undefined && !zone.accepts.some((accepted) => accepted.id === contract.id && accepted.version === contract.version)) {
    return 'contract-not-accepted'
  }
  return null
}

export function validateLayoutOperation(input: {
  readonly operation: LayoutOperation
  readonly page: PageDefinition
  readonly content: PageContent
}): readonly LayoutConstraintIssue[] {
  const operation = input.operation
  const sourceZoneId = operation.kind === 'move' ? operation.fromZone : operation.zone
  const sourceZone = input.page.zones.find((zone) => zone.id === sourceZoneId)
  const source = sourceZone === undefined ? undefined : input.content.zones[sourceZone.id]?.find((item) => item.key === operation.key)
  const issues: LayoutConstraintIssue[] = []

  if (sourceZone === undefined || source === undefined) {
    issues.push(issue('zone-not-allowed', operation.key, sourceZoneId))
    return freezeIssues(issues)
  }

  const sourceAdmission = zoneAdmissionIssue(sourceZone, source)
  if (sourceAdmission === 'zone-not-allowed') issues.push(issue('zone-not-allowed', operation.key, sourceZone.id))

  const policy = normalizeLayoutPolicy(source.contract)
  if (operation.kind === 'move') {
    const destination = input.page.zones.find((zone) => zone.id === operation.toZone)
    if (destination === undefined) {
      issues.push(issue('zone-not-allowed', operation.key, operation.toZone))
    } else {
      if (contractAdmissionIssue(destination, source.contract) !== null) {
        const admission = contractAdmissionIssue(destination, source.contract)
        issues.push(issue(admission === 'contract-not-accepted' ? 'contract-not-accepted' : 'zone-not-allowed', operation.key, destination.id))
      }
    }
    if (!policy.movable) issues.push(issue('not-movable', operation.key, sourceZone.id))
    if (policy.allowedZones !== undefined && !policy.allowedZones.includes(operation.toZone)) {
      issues.push(issue('zone-not-allowed', operation.key, operation.toZone))
    }
  } else if (operation.kind === 'remove') {
    if (!policy.removable) issues.push(issue('not-removable', operation.key, sourceZone.id))
    if (sourceZone.required && usableContentCount(sourceZone, input.content.zones[sourceZone.id] ?? [], operation.key) === 0) {
      issues.push(issue('required-component', operation.key, sourceZone.id))
    }
  } else {
    const targetAdmission = contractAdmissionIssue(sourceZone, operation.contract)
    if (targetAdmission !== null) issues.push(issue(targetAdmission, operation.key, sourceZone.id))
    if (!policy.replaceable) issues.push(issue('not-replaceable', operation.key, sourceZone.id))
    if (policy.allowedZones !== undefined && !policy.allowedZones.includes(sourceZone.id)) {
      issues.push(issue('zone-not-allowed', operation.key, sourceZone.id))
    }
  }

  return freezeIssues(issues)
}

export function isZoneAdmissionAllowed(zone: ZoneDefinition, item: Pick<ZoneContent, 'placement' | 'contract'>): boolean {
  return zoneAdmissionIssue(zone, item) === null
}

function usableContentCount(zone: ZoneDefinition, items: readonly ZoneContent[], excludedKey: string): number {
  return items.reduce((count, item) => {
    if (item.key === excludedKey || zoneAdmissionIssue(zone, item) !== null) return count
    return count + 1
  }, 0)
}

function issue(code: LayoutConstraintIssue['code'], key: string, zone: ZoneId): LayoutConstraintIssue {
  return Object.freeze({ code, key, zone })
}

function freezeIssues(issues: readonly LayoutConstraintIssue[]): readonly LayoutConstraintIssue[] {
  if (issues.length === 0) return EMPTY_ISSUES
  const unique = new Map<string, LayoutConstraintIssue>()
  for (const entry of issues) unique.set(`${entry.code}:${entry.key}:${entry.zone}`, entry)
  return Object.freeze([...unique.values()])
}
