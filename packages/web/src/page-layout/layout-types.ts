import type { LayoutPlacement, LayoutSchema } from '@open-mercato/cezar-extension-api'
import type { ReactElement, ReactNode } from 'react'

import type { PageId, PlacementId, ZoneId } from './definitions'

export type LayoutRenderIssueCode =
  | 'unknown-page'
  | 'unknown-zone'
  | 'missing-placement-adapter'
  | 'contract-not-served'
  | 'placement-not-accepted'
  | 'invalid-placement'
  | 'duplicate-placement'
  | 'cardinality-exceeded'
  | 'required-zone-empty'
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-version'

/** Safe, bounded information that can be shown by a layout diagnostic or fallback. */
export interface LayoutRenderIssue {
  readonly code: LayoutRenderIssueCode
  readonly schemaZone?: string
  readonly pageId?: PageId
  readonly pageZone?: ZoneId
  readonly placementId?: string
  readonly contractId?: string
  readonly contractVersion?: number
  readonly detail?: string
}

export interface TaskLayoutSnapshot {
  readonly identity: string
  readonly schema: LayoutSchema
  readonly source: 'default' | 'supplied'
  readonly diagnostics: readonly LayoutRenderIssue[]
}

export interface BindingRenderInput<Context> {
  readonly context: Context
  readonly placement: LayoutPlacement
  readonly subject: string
}

/** The generic renderer sees only this opaque, already typed route binding. */
export interface ValidatedLayoutBinding<Context> {
  readonly kind: string
  readonly schemaZone: string
  readonly pageZone: ZoneId
  readonly placement: PlacementId
  readonly contractId: string
  readonly contractVersion: number
  readonly render: (input: BindingRenderInput<Context>) => ReactElement
}

export interface LayoutRendererProps<Context> {
  readonly snapshot: TaskLayoutSnapshot
  readonly context: Context
  readonly bindings: readonly ValidatedLayoutBinding<Context>[]
  readonly resolvePageId?: (schemaPage: string) => PageId | undefined
  readonly resolveZoneId?: (schemaZone: string) => ZoneId | undefined
  readonly zones?: readonly string[]
  readonly fallback?: (issue: LayoutRenderIssue) => ReactNode
}
