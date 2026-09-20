import { isValidContributionId, type Disposable } from '@open-mercato/cezar-extension-api'

import {
  normalizePageDefinition,
  type PageContent,
  type PageContentIssue,
  type PageDefinition,
  type PageId,
  type ZoneContent,
  type ZoneDefinition,
  type ZoneId,
} from './definitions'

export interface PageLayoutRegistry {
  registerPage(definition: PageDefinition): Disposable
  getPage(id: PageId): PageDefinition | undefined
  listPages(): readonly PageDefinition[]
  getZone(pageId: PageId, zoneId: ZoneId): ZoneDefinition | undefined
  validateContent(content: PageContent): readonly PageContentIssue[]
  subscribe(listener: () => void): () => void
  revision(): number
}

export interface PagePlacementCandidate {
  readonly key: string
  readonly placement: string
  readonly contractId: string
  readonly contractVersion: number
}

export interface PagePlacementAdmissionState {
  readonly seenKeys: Set<string>
  acceptedCount: number
}

export type PagePlacementAdmissionIssue =
  | { readonly code: 'invalid-content' }
  | { readonly code: 'placement-not-accepted'; readonly placement: string }
  | { readonly code: 'contract-not-accepted'; readonly contractId: string; readonly version: number }
  | { readonly code: 'duplicate-content' }
  | { readonly code: 'cardinality-exceeded' }

/** Shared admission predicate for declarative page content and schema-backed placement adapters. */
export function admitPagePlacement(
  zone: ZoneDefinition,
  candidate: PagePlacementCandidate,
  state: PagePlacementAdmissionState,
): { readonly accepted: true } | { readonly accepted: false; readonly issue: PagePlacementAdmissionIssue } {
  if (!isValidPlacementCandidate(candidate)) return { accepted: false, issue: { code: 'invalid-content' } }
  if (state.seenKeys.has(candidate.key)) return { accepted: false, issue: { code: 'duplicate-content' } }
  state.seenKeys.add(candidate.key)
  if (candidate.placement !== zone.placement) return { accepted: false, issue: { code: 'placement-not-accepted', placement: candidate.placement } }
  if (zone.accepts !== undefined && !zone.accepts.some((contract) => contract.id === candidate.contractId && contract.version === candidate.contractVersion)) {
    return { accepted: false, issue: { code: 'contract-not-accepted', contractId: candidate.contractId, version: candidate.contractVersion } }
  }
  if (zone.cardinality === 'single' && state.acceptedCount > 0) return { accepted: false, issue: { code: 'cardinality-exceeded' } }
  return { accepted: true }
}

/** A small store rather than a singleton: previews, tests and future app shells need isolation. */
export function createPageLayoutRegistry(): PageLayoutRegistry {
  const pages = new Map<PageId, PageDefinition>()
  const listeners = new Set<() => void>()
  let currentRevision = 0

  const changed = (): void => {
    currentRevision += 1
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A diagnostic subscriber cannot prevent the registry from changing.
      }
    }
  }

  return {
    registerPage(definition) {
      const normalized = normalizePageDefinition(definition)
      if (pages.has(normalized.id)) throw new Error(`Page "${normalized.id}" is already registered`)
      pages.set(normalized.id, normalized)
      changed()
      let disposed = false
      return {
        dispose() {
          if (disposed) return
          disposed = true
          if (pages.get(normalized.id) !== normalized) return
          pages.delete(normalized.id)
          changed()
        },
      }
    },

    getPage(id) {
      return pages.get(id)
    },

    listPages() {
      return Object.freeze([...pages.values()])
    },

    getZone(pageId, zoneId) {
      return pages.get(pageId)?.zones.find((zone) => zone.id === zoneId)
    },

    validateContent(content) {
      return validateContent(pages, content)
    },

    subscribe(listener) {
      listeners.add(listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
      }
    },

    revision() {
      return currentRevision
    },
  }
}

function validateContent(pages: ReadonlyMap<PageId, PageDefinition>, content: PageContent): readonly PageContentIssue[] {
  if (!isRecord(content) || typeof content.pageId !== 'string' || !isRecord(content.zones)) {
    return Object.freeze([{ code: 'invalid-content', zoneId: '' as ZoneId }])
  }

  const page = pages.get(content.pageId)
  if (page === undefined) return Object.freeze([{ code: 'unknown-page', pageId: content.pageId }])

  const issues: PageContentIssue[] = []
  const knownZones = new Set(page.zones.map((zone) => zone.id))
  for (const zoneId of Object.keys(content.zones)) {
    if (!knownZones.has(zoneId)) issues.push({ code: 'unknown-zone', pageId: page.id, zoneId })
  }

  for (const zone of page.zones) {
    const rawItems = content.zones[zone.id]
    if (rawItems === undefined) {
      if (zone.required) issues.push({ code: 'required-zone-empty', zoneId: zone.id })
      continue
    }
    if (!Array.isArray(rawItems)) {
      issues.push({ code: 'invalid-content', zoneId: zone.id })
      if (zone.required) issues.push({ code: 'required-zone-empty', zoneId: zone.id })
      continue
    }
    if (zone.cardinality === 'single' && rawItems.length > 1) {
      issues.push({ code: 'cardinality-exceeded', zoneId: zone.id })
    }
    const state: PagePlacementAdmissionState = { seenKeys: new Set<string>(), acceptedCount: 0 }
    for (const item of rawItems) {
      const candidate = isZoneContent(item) ? {
        key: item.key,
        placement: item.placement,
        contractId: item.contract.id,
        contractVersion: item.contract.version,
      } : item as PagePlacementCandidate
      const admission = admitPagePlacement(zone, candidate, state)
      if (!admission.accepted) {
        if (admission.issue.code === 'placement-not-accepted') issues.push({ code: admission.issue.code, zoneId: zone.id, placement: admission.issue.placement })
        else if (admission.issue.code === 'contract-not-accepted') issues.push({ code: admission.issue.code, zoneId: zone.id, contractId: admission.issue.contractId, version: admission.issue.version })
        else if (admission.issue.code === 'cardinality-exceeded') issues.push({ code: admission.issue.code, zoneId: zone.id })
        else issues.push({ code: 'invalid-content', zoneId: zone.id })
        continue
      }
      state.acceptedCount += 1
    }
    if (zone.required && state.acceptedCount === 0) issues.push({ code: 'required-zone-empty', zoneId: zone.id })
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)))
}

function isZoneContent(value: unknown): value is ZoneContent {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.length === 0 || !isRecord(value.contract)) return false
  return (
    typeof value.placement === 'string' &&
    isValidContributionId(value.placement) &&
    value.contract.kind === 'component' &&
    typeof value.contract.id === 'string' &&
    isValidContributionId(value.contract.id) &&
    isPositiveInteger(value.contract.version) &&
    isRecord(value.props)
  )
}

function isValidPlacementCandidate(value: unknown): value is PagePlacementCandidate {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.key === 'string' && candidate.key.length > 0 &&
    typeof candidate.placement === 'string' && isValidContributionId(candidate.placement) &&
    typeof candidate.contractId === 'string' && isValidContributionId(candidate.contractId) &&
    typeof candidate.contractVersion === 'number' && Number.isInteger(candidate.contractVersion) && candidate.contractVersion >= 1
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
