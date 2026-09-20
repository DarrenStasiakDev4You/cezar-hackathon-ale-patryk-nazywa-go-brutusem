import { Fragment, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import type { LayoutPlacement } from '@open-mercato/cezar-extension-api'

import type { LayoutRenderIssue, LayoutRendererProps, ValidatedLayoutBinding } from './layout-types'
import type { PageDefinition, ZoneDefinition } from './definitions'
import { usePageLayoutRegistry } from './renderer'

/**
 * Consumes a normalized layout document without knowing about any concrete component. The route
 * supplies the typed binding; this module only performs page admission and delegates rendering to
 * that binding, which is the same ComponentHost path used by ordinary page content.
 */
export function LayoutRenderer<Context>({
  snapshot,
  context,
  bindings,
  resolvePageId,
  resolveZoneId,
  zones: requestedZones,
  fallback,
}: LayoutRendererProps<Context>): ReactElement {
  const registry = usePageLayoutRegistry()
  useSyncExternalStore(registry.subscribe, registry.revision, registry.revision)

  const pageId = (resolvePageId ?? identity)(snapshot.schema.page)
  if (pageId === undefined) {
    return <LayoutIssueFallback issue={{ code: 'unknown-page', detail: snapshot.schema.page }} fallback={fallback} />
  }

  const page = registry.getPage(pageId)
  if (page === undefined) {
    return <LayoutIssueFallback issue={{ code: 'unknown-page', pageId }} fallback={fallback} />
  }

  const requested = requestedZones === undefined ? undefined : new Set(requestedZones)
  const rendered = Object.keys(snapshot.schema.zones)
    .filter((schemaZone) => requested === undefined || requested.has(schemaZone))
    .map((schemaZone) => {
      const zone = renderSchemaZone({
          page,
          pageId,
          schemaZone,
          pageZoneId: (resolveZoneId ?? identity)(schemaZone),
          placements: snapshot.schema.zones[schemaZone] ?? [],
          bindings,
          context,
          fallback,
          identity: snapshot.identity,
        })
      return zone === null ? null : <Fragment key={schemaZone}>{zone}</Fragment>
    })
    .filter((zone): zone is ReactElement => zone !== null)

  return (
    <div data-page-id={page.id} data-page-version={page.version} data-page-layout="schema">
      {rendered}
    </div>
  )
}

function identity(value: string): string {
  return value
}

function renderSchemaZone<Context>(input: {
  readonly page: PageDefinition
  readonly pageId: string
  readonly schemaZone: string
  readonly pageZoneId: string | undefined
  readonly placements: readonly LayoutPlacement[]
  readonly bindings: readonly ValidatedLayoutBinding<Context>[]
  readonly context: Context
  readonly fallback?: (issue: LayoutRenderIssue) => ReactNode
  readonly identity: string
}): ReactElement | null {
  const { page, pageId, schemaZone, pageZoneId, placements, bindings, context, fallback, identity } = input
  if (pageZoneId === undefined) {
    return <LayoutIssueFallback issue={{ code: 'unknown-zone', schemaZone, pageId }} fallback={fallback} />
  }
  const zone = page.zones.find((candidate) => candidate.id === pageZoneId)
  if (zone === undefined) {
    return <LayoutIssueFallback issue={{ code: 'unknown-zone', schemaZone, pageId, pageZone: pageZoneId }} fallback={fallback} />
  }

  const seenIds = new Set<string>()
  const accepted: ReactElement[] = []
  let issue: LayoutRenderIssue | undefined
  for (const placement of placements) {
    if (seenIds.has(placement.id)) {
      issue = { code: 'duplicate-placement', schemaZone, pageId, pageZone: zone.id, placementId: placement.id }
      continue
    }
    seenIds.add(placement.id)

    const binding = bindings.find((candidate) =>
      candidate.schemaZone === schemaZone &&
      candidate.pageZone === zone.id &&
      candidate.placement === zone.placement &&
      candidate.contractId === placement.contract &&
      candidate.contractVersion === placement.contractVersion,
    )
    if (binding === undefined) {
      issue = {
        code: bindings.some((candidate) => candidate.schemaZone === schemaZone && candidate.contractId === placement.contract)
          ? 'placement-not-accepted'
          : 'missing-placement-adapter',
        schemaZone,
        pageId,
        pageZone: zone.id,
        placementId: placement.id,
        contractId: placement.contract,
        contractVersion: placement.contractVersion,
      }
      continue
    }
    if (zone.accepts !== undefined && !zone.accepts.some((contract) => contract.id === placement.contract && contract.version === placement.contractVersion)) {
      issue = { code: 'contract-not-served', schemaZone, pageId, pageZone: zone.id, placementId: placement.id, contractId: placement.contract, contractVersion: placement.contractVersion }
      continue
    }
    if (zone.cardinality === 'single' && accepted.length > 0) {
      issue = { code: 'cardinality-exceeded', schemaZone, pageId, pageZone: zone.id, placementId: placement.id }
      continue
    }
    const subject = `task:${identity}:${schemaZone}:${placement.id}`
    try {
      accepted.push(
        <div key={placement.id} data-placement-id={placement.id} data-contract-id={placement.contract}>
          {binding.render({ context, placement, subject })}
        </div>,
      )
    } catch {
      issue = { code: 'invalid-placement', schemaZone, pageId, pageZone: zone.id, placementId: placement.id }
    }
  }

  if (accepted.length === 0) {
    if (!zone.required) return null
    const requiredIssue = issue ?? { code: 'required-zone-empty' as const, schemaZone, pageId, pageZone: zone.id }
    return <ZoneBox pageId={pageId} zone={zone} schemaZone={schemaZone} state="error">{fallback?.(requiredIssue) ?? <LayoutIssueFallback issue={requiredIssue} />}</ZoneBox>
  }

  return <ZoneBox pageId={pageId} zone={zone} schemaZone={schemaZone} state="ready">{accepted}</ZoneBox>
}

function ZoneBox(props: {
  readonly pageId: string
  readonly schemaZone: string
  readonly zone: ZoneDefinition
  readonly state: 'ready' | 'error'
  readonly children: ReactNode
}): ReactElement {
  const minBlockSize = props.zone.layout?.minBlockSize
  return (
    <section
      data-slot="page-layout-zone"
      data-page-id={props.pageId}
      data-zone-id={props.zone.id}
      data-schema-zone={props.schemaZone}
      data-zone-state={props.state}
      data-page-layout="zone"
      style={minBlockSize === undefined ? undefined : { minBlockSize: `${minBlockSize}px` }}
    >
      {props.children}
    </section>
  )
}

function LayoutIssueFallback(props: { readonly issue: LayoutRenderIssue; readonly fallback?: (issue: LayoutRenderIssue) => ReactNode }): ReactElement {
  return <>{props.fallback?.(props.issue) ?? <div role="alert" data-page-layout-state="error">Layout placement unavailable.</div>}</>
}
