import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { defineComponentContract, type ComponentImplementation } from '@open-mercato/cezar-extension-api'

import { createComponentRegistry } from '@/component-registry/registry'
import { ComponentsProvider } from '@/component-registry/provider'

import { definePage, type PageContent } from './definitions'
import { PageLayoutProvider, PageRenderer } from './renderer'
import { createPageLayoutRegistry } from './registry'

const Card = defineComponentContract<{ readonly label: string }>('cezar.fixture.renderer-card', { version: 1 })
const DEFAULT_ID = 'cezar.fixture.renderer-card.default'

function CardView({ label }: { readonly label: string }) {
  return <span data-testid="card">{label}</span>
}

const implementation: ComponentImplementation<{ readonly label: string }> = {
  id: DEFAULT_ID,
  title: 'Fixture card',
  component: CardView,
}

const layout = () => {
  const pageRegistry = createPageLayoutRegistry()
  pageRegistry.registerPage(
    definePage({
      id: 'fixture.renderer-page',
      version: 1,
      zones: [
        { id: 'fixture.content', accepts: [Card], cardinality: 'many', required: true, layout: { minBlockSize: 24 } },
        { id: 'fixture.empty', accepts: [Card], cardinality: 'many', required: false },
      ],
    }),
  )
  const components = createComponentRegistry({ contracts: [Card], onDiagnostic: () => {} })
  components.register(Card, implementation)
  return { pageRegistry, components }
}

function renderPage(content: PageContent) {
  const { pageRegistry, components } = layout()
  return render(
    <ComponentsProvider registry={components}>
      <PageLayoutProvider registry={pageRegistry}>
        <PageRenderer content={content} />
      </PageLayoutProvider>
    </ComponentsProvider>,
  )
}

afterEach(() => cleanup())

describe('PageRenderer', () => {
  it('renders accepted content through ComponentHost in declaration and adapter order', () => {
    renderPage({
      pageId: 'fixture.renderer-page',
      zones: {
        'fixture.content': [
          { key: 'a', contract: Card, props: { label: 'A' } },
          { key: 'b', contract: Card, props: { label: 'B' } },
        ],
      },
    })

    expect(screen.getAllByTestId('card').map((item) => item.textContent)).toEqual(['A', 'B'])
    expect((screen.getAllByTestId('card')[0]?.closest('[data-zone-id="fixture.content"]') as HTMLElement | null)?.style.minBlockSize).toBe('24px')
    expect(screen.queryByRole('region', { name: 'fixture.empty' })).toBeNull()
    expect(document.querySelector('[data-slot="component-host"][data-contract="cezar.fixture.renderer-card"]')).not.toBeNull()
  })

  it('keeps a required zone visible with an inline error when it has no usable content', () => {
    renderPage({ pageId: 'fixture.renderer-page', zones: {} })

    expect(screen.getByRole('alert').textContent).toBe('Zone "fixture.content" is unavailable.')
    expect(document.querySelector('[data-zone-id="fixture.content"][data-zone-state="error"]')).not.toBeNull()
  })

  it('uses a caller fallback for a required-zone error without knowing component types', () => {
    const { pageRegistry, components } = layout()
    render(
      <ComponentsProvider registry={components}>
        <PageLayoutProvider registry={pageRegistry}>
          <PageRenderer
            content={{ pageId: 'fixture.renderer-page', zones: {} }}
            fallback={(issue, zone) => <div role="alert">{issue.code}:{zone.id}</div>}
          />
        </PageLayoutProvider>
      </ComponentsProvider>,
    )

    expect(screen.getByRole('alert').textContent).toBe('invalid-content:fixture.content')
  })

  it('reports an unregistered page without importing or selecting a concrete component', () => {
    const pageRegistry = createPageLayoutRegistry()
    const components = createComponentRegistry({ contracts: [Card], onDiagnostic: () => {} })
    components.register(Card, implementation)

    render(
      <ComponentsProvider registry={components}>
        <PageLayoutProvider registry={pageRegistry}>
          <PageRenderer content={{ pageId: 'missing.page', zones: {} }} />
        </PageLayoutProvider>
      </ComponentsProvider>,
    )

    expect(screen.getByRole('alert').textContent).toBe('Page "missing.page" is not registered.')
    expect(screen.queryByTestId('card')).toBeNull()
  })

  it('observes a page definition registered after the first render', () => {
    const pageRegistry = createPageLayoutRegistry()
    const components = createComponentRegistry({ contracts: [Card], onDiagnostic: () => {} })
    components.register(Card, implementation)
    const definition = definePage({
      id: 'fixture.late-page',
      version: 1,
      zones: [{ id: 'fixture.late-content', accepts: [Card], cardinality: 'single', required: true }],
    })

    render(
      <ComponentsProvider registry={components}>
        <PageLayoutProvider registry={pageRegistry}>
          <PageRenderer content={{ pageId: 'fixture.late-page', zones: { 'fixture.late-content': [{ key: 'card', contract: Card, props: { label: 'late' } }] } }} />
        </PageLayoutProvider>
      </ComponentsProvider>,
    )
    expect(screen.getByRole('alert').textContent).toContain('not registered')

    act(() => {
      pageRegistry.registerPage(definition)
    })
    expect(screen.getByTestId('card').textContent).toBe('late')
  })
})
