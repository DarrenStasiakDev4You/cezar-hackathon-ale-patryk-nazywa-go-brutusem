import { createContext, useContext, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import type { ComponentContract } from '@open-mercato/cezar-extension-api'

import { ComponentHost } from '@/component-registry/component-host'

import type {
  PageContent,
  PageContentIssue,
  PageDefinition,
  PageId,
  PageComponentContract,
  ZoneContent,
  ZoneDefinition,
} from './definitions'
import { createPageLayoutRegistry, type PageLayoutRegistry } from './registry'

const PageLayoutContext = createContext<PageLayoutRegistry | null>(null)

export function PageLayoutProvider(props: { readonly registry?: PageLayoutRegistry; readonly children: ReactNode }): ReactElement {
  const [registry] = useState(() => props.registry ?? createPageLayoutRegistry())
  return <PageLayoutContext.Provider value={registry}>{props.children}</PageLayoutContext.Provider>
}

export function usePageLayoutRegistry(): PageLayoutRegistry {
  const registry = useContext(PageLayoutContext)
  if (registry === null) throw new Error('Page layout components must be used inside <PageLayoutProvider>')
  return registry
}

export interface PageRendererProps {
  readonly content: PageContent
  readonly fallback?: (issue: PageContentIssue, zone: ZoneDefinition) => ReactNode
}

export function PageRenderer({ content, fallback }: PageRendererProps): ReactElement {
  const registry = usePageLayoutRegistry()
  useSyncExternalStore(registry.subscribe, registry.revision, registry.revision)
  const page = registry.getPage(content.pageId)

  if (page === undefined) {
    return <LayoutError message={`Page "${content.pageId}" is not registered.`} pageId={content.pageId} />
  }

  const issues = registry.validateContent(content)
  return (
    <div data-page-id={page.id} data-page-version={page.version} data-page-layout="page">
      {page.zones.map((zone) => (
        <ZoneRenderer
          key={zone.id}
          pageId={page.id}
          zone={zone}
          content={content.zones[zone.id]}
          issues={issues.filter((issue) => 'zoneId' in issue && issue.zoneId === zone.id)}
          fallback={fallback}
        />
      ))}
    </div>
  )
}

export interface ZoneRendererProps {
  readonly pageId: PageId
  readonly zone: ZoneDefinition
  readonly content?: readonly ZoneContent[]
  readonly issues?: readonly PageContentIssue[]
  readonly fallback?: (issue: PageContentIssue, zone: ZoneDefinition) => ReactNode
}

export function ZoneRenderer({ pageId, zone, content = [], issues = [], fallback }: ZoneRendererProps): ReactElement | null {
  const accepted = content.filter((item) => accepts(zone, item))
  if (accepted.length === 0) {
    if (!zone.required) return null
    const issue = issues[0] ?? { code: 'invalid-content' as const, zoneId: zone.id }
    return (
      <ZoneBox pageId={pageId} zone={zone} state="error">
        {fallback?.(issue, zone) ?? <LayoutError message={`Zone "${zone.id}" is unavailable.`} pageId={pageId} zoneId={zone.id} />}
      </ZoneBox>
    )
  }

  return (
    <ZoneBox pageId={pageId} zone={zone} state="ready">
      {accepted.map((item) => (
        <ComponentHost
          key={item.key}
          contract={item.contract as ComponentContract<object>}
          subject={`${pageId}:${zone.id}:${item.key}`}
          props={item.props as object}
        />
      ))}
    </ZoneBox>
  )
}

function ZoneBox(props: { readonly pageId: PageId; readonly zone: ZoneDefinition; readonly state: 'ready' | 'error'; readonly children: ReactNode }): ReactElement {
  const minBlockSize = props.zone.layout?.minBlockSize
  return (
    <section
      data-page-id={props.pageId}
      data-zone-id={props.zone.id}
      data-zone-state={props.state}
      data-page-layout="zone"
      style={minBlockSize === undefined ? undefined : { minBlockSize: `${minBlockSize}px` }}
    >
      {props.children}
    </section>
  )
}

function LayoutError(props: { readonly message: string; readonly pageId: string; readonly zoneId?: string }): ReactElement {
  return (
    <div role="alert" data-page-layout-state="error" data-page-id={props.pageId} data-zone-id={props.zoneId}>
      {props.message}
    </div>
  )
}

function accepts(zone: ZoneDefinition, content: ZoneContent): boolean {
  return zone.accepts.some((contract) => contract.id === content.contract.id && contract.version === content.contract.version)
}

export type { PageComponentContract }
