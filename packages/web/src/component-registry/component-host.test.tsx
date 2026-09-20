import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { lazy, StrictMode, useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  defineComponentContract,
  type ComponentImplementation,
  type ComponentLayout,
  type ContributionId,
} from '@open-mercato/cezar-extension-api'

import { resetToasts, Toaster } from '@/components/ui/toaster'

import { fakeScope } from '../extensions/registry.fixtures'
import { boxOf, ComponentHost, useHostedComponent } from './component-host'
import { ComponentsProvider, useComponentRegistry, type ImplementationFailure } from './provider'
import { createComponentRegistry, type CockpitComponentRegistry } from './registry'

interface HeaderProps {
  readonly title: string
}

/** The brief's `task.header@1`, as a fixture contract: nothing in production serves it. */
const Header = defineComponentContract<HeaderProps>('cezar.fixture.task-header', {
  version: 1,
  requiredCapabilities: ['shows-title'],
  layout: { minBlockSize: 30 },
})

const DEFAULT_ID = 'cezar.fixture.task-header.default'
const JIRA_ID = 'acme.jira.task-header'
const COMPACT_ID = 'acme.compact.task-header'

/** How each fixture implementation behaves on its next render: fine, or throwing in render or in an effect. */
type Mode = 'ok' | 'render' | 'effect'
const behaviour: Record<'core' | 'jira', Mode> = { core: 'ok', jira: 'ok' }
const renders = { core: 0, jira: 0 }

function useFailure(mode: Mode, who: string): void {
  useEffect(() => {
    if (mode === 'effect') throw new Error(`${who} effect bug`)
  })
  if (mode === 'render') throw new Error(`${who} render bug`)
}

function CoreHeader({ title }: HeaderProps) {
  renders.core += 1
  useFailure(behaviour.core, 'core')
  return <h1 data-testid="core-header">{title}</h1>
}

function JiraHeader({ title }: HeaderProps) {
  renders.jira += 1
  useFailure(behaviour.jira, 'jira')
  return <h1 data-testid="jira-header">JIRA-1 {title}</h1>
}

function CompactHeader({ title }: HeaderProps) {
  return <span data-testid="compact-header">{title}</span>
}

const jiraHeader: ComponentImplementation<HeaderProps> = {
  id: JIRA_ID,
  title: 'Jira header',
  capabilities: ['shows-title'],
  component: JiraHeader,
}

/** Core's default and two extension implementations, as in `resolve.test.ts`. */
function fixture() {
  const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
  registry.register(Header, { id: DEFAULT_ID, title: 'Task header', capabilities: ['shows-title'], component: CoreHeader })
  const jira = fakeScope('acme.jira')
  const provideJira = () => registry.forExtension(jira.scope).provide(Header, jiraHeader)
  const jiraHandle = provideJira()
  registry
    .forExtension(fakeScope('acme.compact').scope)
    .provide(Header, { id: COMPACT_ID, title: 'Compact header', capabilities: ['shows-title'], component: CompactHeader })
  return { registry, jira, jiraHandle, provideJira }
}

const prefer =
  (componentId: ContributionId | null) =>
  (contractId: ContributionId): ContributionId | null =>
    contractId === Header.id ? componentId : null

interface Options {
  readonly registry: CockpitComponentRegistry
  readonly preferenceOf?: (contractId: ContributionId) => ContributionId | null
  readonly onImplementationError?: (failure: ImplementationFailure) => void
  readonly strict?: boolean
}

function tree(ui: ReactNode, options: Options) {
  const provided = (
    <ComponentsProvider
      registry={options.registry}
      preferenceOf={options.preferenceOf}
      onImplementationError={options.onImplementationError}
    >
      {ui}
    </ComponentsProvider>
  )
  return options.strict === true ? <StrictMode>{provided}</StrictMode> : provided
}

const header = (subject = 'task-1', title = 'Summarize the README') => (
  <ComponentHost contract={Header} subject={subject} props={{ title }} />
)

function hostBox(container: HTMLElement, index = 0): HTMLElement {
  const box = container.querySelectorAll<HTMLElement>('[data-slot="component-host"]')[index]
  if (box === undefined) throw new Error('no host box')
  return box
}

/** The `[cezar:extensions]` lines written through `console.error`. */
const extensionLines = (spy: MockInstance) =>
  spy.mock.calls.map(([first]) => first).filter((first): first is string => typeof first === 'string' && first.startsWith('[cezar:extensions]'))

let consoleError: MockInstance

beforeEach(() => {
  behaviour.core = 'ok'
  behaviour.jira = 'ok'
  renders.core = 0
  renders.jira = 0
  // React logs every error a boundary catches; the tests assert on the host's own lines.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  act(() => resetToasts())
  vi.restoreAllMocks()
})

describe('ComponentHost: which implementation renders', () => {
  it('renders core’s default without a preference, and the box names it', () => {
    const { registry } = fixture()
    const { container } = render(tree(header(), { registry }))

    expect(screen.getByTestId('core-header').textContent).toBe('Summarize the README')
    const box = hostBox(container)
    expect(box.dataset.contract).toBe(Header.id)
    expect(box.dataset.component).toBe(DEFAULT_ID)
    expect(box.dataset.state).toBe('resolved')
  })

  it('renders the preferred extension implementation, with the props passed through', () => {
    const { registry } = fixture()
    const { container } = render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID) }))

    expect(screen.getByTestId('jira-header').textContent).toBe('JIRA-1 Summarize the README')
    expect(screen.queryByTestId('core-header')).toBeNull()
    expect(hostBox(container).dataset.component).toBe(JIRA_ID)
    expect(hostBox(container).dataset.state).toBe('resolved')
  })

  it('re-resolves when preferenceOf changes identity', () => {
    const { registry } = fixture()
    const { rerender } = render(tree(header(), { registry, preferenceOf: prefer(null) }))
    expect(screen.getByTestId('core-header')).toBeTruthy()

    rerender(tree(header(), { registry, preferenceOf: prefer(COMPACT_ID) }))

    expect(screen.getByTestId('compact-header')).toBeTruthy()
    expect(screen.queryByTestId('core-header')).toBeNull()
  })

  it('swaps in an implementation that is provided after the first paint', () => {
    const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    registry.register(Header, { id: DEFAULT_ID, title: 'Task header', capabilities: ['shows-title'], component: CoreHeader })
    render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID) }))
    expect(screen.getByTestId('core-header')).toBeTruthy()

    act(() => {
      registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)
    })

    expect(screen.getByTestId('jira-header')).toBeTruthy()
  })

  it('re-renders core’s default when the chosen extension’s registration is disposed, with no report', () => {
    const { registry, jira } = fixture()
    const onImplementationError = vi.fn()
    const { container } = render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }))
    expect(screen.getByTestId('jira-header')).toBeTruthy()

    act(() => jira.end())

    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(hostBox(container).dataset.state).toBe('resolved')
    expect(onImplementationError).not.toHaveBeenCalled()
    expect(extensionLines(consoleError)).toEqual([])
  })
})

describe('ComponentHost: an extension implementation that throws', () => {
  it.each<[string, Mode]>([
    ['in render', 'render'],
    ['in an effect', 'effect'],
  ])('renders core’s default in its place when it throws %s, and the page keeps working', (_label, mode) => {
    const { registry } = fixture()
    behaviour.jira = mode
    const { container } = render(
      tree(
        <>
          {header()}
          <p data-testid="sibling">The actions and the tabs</p>
        </>,
        { registry, preferenceOf: prefer(JIRA_ID), onImplementationError: () => {} },
      ),
    )

    expect(screen.getByTestId('core-header').textContent).toBe('Summarize the README')
    expect(screen.queryByTestId('jira-header')).toBeNull()
    expect(screen.getByTestId('sibling')).toBeTruthy()
    expect(hostBox(container).dataset.state).toBe('fallback')
    expect(hostBox(container).dataset.component).toBe(DEFAULT_ID)
  })

  it('reports the failure once, with the registration, core’s default and the error', () => {
    const { registry, jiraHandle } = fixture()
    void jiraHandle
    behaviour.jira = 'render'
    const onImplementationError = vi.fn()
    render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }))

    expect(onImplementationError).toHaveBeenCalledTimes(1)
    const [failure] = onImplementationError.mock.calls[0] as [ImplementationFailure]
    expect(failure.registration).toBe(registry.get(JIRA_ID))
    expect(failure.fallback).toBe(registry.get(DEFAULT_ID))
    expect(failure.error).toEqual(new Error('jira render bug'))
  })

  it.each<[string, Mode]>([
    ['in render', 'render'],
    ['in an effect', 'effect'],
  ])('reports once under StrictMode when it throws %s', (_label, mode) => {
    const { registry } = fixture()
    behaviour.jira = mode
    const onImplementationError = vi.fn()
    render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError, strict: true }))

    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(onImplementationError).toHaveBeenCalledTimes(1)
  })

  it('reports once for two hosts of the same subject, and once across two subjects', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    const onImplementationError = vi.fn()
    render(
      tree(
        <>
          {header('task-1')}
          {header('task-1')}
          {header('task-2')}
        </>,
        { registry, preferenceOf: prefer(JIRA_ID), onImplementationError },
      ),
    )

    expect(screen.getAllByTestId('core-header')).toHaveLength(3)
    expect(onImplementationError).toHaveBeenCalledTimes(1)
  })

  it('calls the reporter from componentDidCatch, never during render', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    const stacks: string[] = []
    // During render nothing is in the document yet; by componentDidCatch the commit has put core's
    // default there. That is behaviour, not a React internal's name.
    const committed: boolean[] = []
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 100
    try {
      render(
        tree(header(), {
          registry,
          preferenceOf: prefer(JIRA_ID),
          onImplementationError: () => {
            stacks.push(new Error('where').stack ?? '')
            committed.push(document.querySelector('[data-testid="core-header"]') !== null)
          },
        }),
      )
    } finally {
      Error.stackTraceLimit = limit
    }

    expect(stacks).toHaveLength(1)
    expect(stacks[0]).toMatch(/componentDidCatch/)
    expect(committed).toEqual([true])
  })

  it('keeps the failed implementation set aside for its subject after a remount; another subject tries it again', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    const onImplementationError = vi.fn()
    const options = { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }
    const { rerender } = render(tree(header('task-1'), options))
    const triedOnce = renders.jira

    // Unmount the host (as a tab change does), then mount it again for the same task.
    rerender(tree(null, options))
    rerender(tree(header('task-1'), options))

    expect(renders.jira).toBe(triedOnce)
    expect(screen.getByTestId('core-header')).toBeTruthy()

    rerender(tree(header('task-2'), options))

    expect(renders.jira).toBeGreaterThan(triedOnce)
    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(onImplementationError).toHaveBeenCalledTimes(1)
  })

  it('tries a re-provided implementation (a new registration) again', () => {
    const { registry, jiraHandle, provideJira } = fixture()
    behaviour.jira = 'render'
    const onImplementationError = vi.fn()
    const { container } = render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }))
    expect(hostBox(container).dataset.state).toBe('fallback')

    behaviour.jira = 'ok'
    act(() => {
      jiraHandle.dispose()
      provideJira()
    })

    expect(screen.getByTestId('jira-header')).toBeTruthy()
    expect(hostBox(container).dataset.state).toBe('resolved')
    expect(onImplementationError).toHaveBeenCalledTimes(1)
  })

  it('shows the inline notice when core’s default throws too', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    behaviour.core = 'render'
    const onImplementationError = vi.fn()
    const { container } = render(tree(header(), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }))

    expect(screen.getByRole('alert').textContent).toContain('This part of the page could not be displayed.')
    expect(hostBox(container).dataset.state).toBe('failed')
    expect(hostBox(container).dataset.component).toBe(DEFAULT_ID)
    expect(onImplementationError).toHaveBeenCalledTimes(1)
    // One line for core's failure: the boundary that renders core's default at once reports
    // nothing, and the host's own retry of it does.
    expect(extensionLines(consoleError)).toEqual([`[cezar:extensions] core's ${DEFAULT_ID} failed while rendering`])
  })
})

describe('ComponentHost: core’s default throws', () => {
  it('renders the inline alert, reports no failure, and Try again remounts it', () => {
    const { registry } = fixture()
    behaviour.core = 'render'
    const onImplementationError = vi.fn()
    const { container } = render(
      tree(
        <>
          {header()}
          <p data-testid="sibling">The thread and the composer</p>
        </>,
        { registry, onImplementationError },
      ),
    )

    expect(screen.getByRole('alert').textContent).toContain('This part of the page could not be displayed.')
    expect(hostBox(container).dataset.state).toBe('failed')
    expect(screen.getByTestId('sibling')).toBeTruthy()
    expect(onImplementationError).not.toHaveBeenCalled()
    expect(extensionLines(consoleError)).toEqual([`[cezar:extensions] core's ${DEFAULT_ID} failed while rendering`])

    behaviour.core = 'ok'
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hostBox(container).dataset.state).toBe('resolved')
  })

  it('tries core’s default again for another subject, without Try again', () => {
    const { registry } = fixture()
    behaviour.core = 'render'
    const { container, rerender } = render(tree(header('task-1'), { registry }))
    expect(hostBox(container).dataset.state).toBe('failed')

    behaviour.core = 'ok'
    // The same host, now showing another task: RunHeader stays mounted when the user switches tasks.
    rerender(tree(header('task-2'), { registry }))

    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hostBox(container).dataset.state).toBe('resolved')
  })

  it('does not mark a healthy box failed when an earlier boundary with the same key failed', () => {
    const { registry } = fixture()
    behaviour.core = 'render'
    const { container, rerender } = render(tree(header(), { registry, preferenceOf: prefer(null) }))
    expect(hostBox(container).dataset.state).toBe('failed')

    behaviour.core = 'ok'
    rerender(tree(header(), { registry, preferenceOf: prefer(COMPACT_ID) }))
    expect(screen.getByTestId('compact-header')).toBeTruthy()
    rerender(tree(header(), { registry, preferenceOf: prefer(null) }))

    expect(screen.getByTestId('core-header')).toBeTruthy()
    expect(hostBox(container).dataset.state).toBe('resolved')
  })

  it('shows the notice again when Try again fails again', () => {
    const { registry } = fixture()
    behaviour.core = 'effect'
    render(tree(header(), { registry }))
    const before = renders.core

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(renders.core).toBeGreaterThan(before)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('ComponentHost: an unresolved contract', () => {
  it('renders the empty box and writes one console.error line, even under StrictMode and after a remount', () => {
    // Served, but core registered no default: the gate test forbids it.
    const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)
    const options = { registry, preferenceOf: prefer(JIRA_ID), strict: true }
    const { container, rerender } = render(tree(header(), options))

    const box = hostBox(container)
    expect(box.dataset.state).toBe('unresolved')
    expect(box.dataset.component).toBeUndefined()
    expect(box.childNodes).toHaveLength(0)
    expect(screen.queryByTestId('jira-header')).toBeNull()

    rerender(tree(null, options))
    rerender(tree(header(), options))

    expect(extensionLines(consoleError)).toEqual([
      '[cezar:extensions] cezar.fixture.task-header has no core default: nothing renders in its host',
    ])
  })
})

describe('ComponentHost: the box', () => {
  it('lets the contract box, rather than the failure notice, reserve its height', () => {
    const { registry } = fixture()
    behaviour.core = 'render'
    const { container } = render(tree(header(), { registry }))

    expect(hostBox(container).getAttribute('style')).toBe('min-block-size: 30px;')
    expect(screen.getByRole('alert').className).not.toContain('min-h-[30px]')
  })

  it.each<[string, ComponentLayout | undefined, string | undefined, string | undefined]>([
    ['no layout', undefined, undefined, undefined],
    ['sticky top', { sticky: 'top' }, 'relative z-20 md:sticky md:top-0', undefined],
    ['sticky bottom', { sticky: 'bottom' }, 'md:sticky md:bottom-0', undefined],
    ['fill', { sizing: 'fill' }, 'flex min-h-0 flex-1 flex-col', undefined],
    ['content', { sizing: 'content' }, undefined, undefined],
    ['minBlockSize', { minBlockSize: 30 }, undefined, '30px'],
    ['minBlockSize 0', { minBlockSize: 0 }, undefined, '0px'],
    [
      'everything',
      { sticky: 'top', sizing: 'fill', minBlockSize: 48 },
      'relative z-20 md:sticky md:top-0 flex min-h-0 flex-1 flex-col',
      '48px',
    ],
    ['an unknown key and values', { sticky: 'left', minBlockSize: -1, extra: true } as unknown as ComponentLayout, undefined, undefined],
  ])('turns %s into its classes and style', (_label, layout, className, minBlockSize) => {
    const box = boxOf(layout)

    expect(box.className).toBe(className)
    expect(box.style).toEqual(minBlockSize === undefined ? undefined : { minBlockSize })
  })

  it('renders the box with the contract’s layout', () => {
    const Sticky = defineComponentContract<HeaderProps>('cezar.fixture.sticky', {
      version: 1,
      layout: { sticky: 'top', sizing: 'fill', minBlockSize: 30 },
    })
    const registry = createComponentRegistry({ contracts: [Sticky], onDiagnostic: () => {} })
    registry.register(Sticky, { id: 'cezar.fixture.sticky.default', title: 'Sticky', component: CoreHeader })
    const { container } = render(tree(<ComponentHost contract={Sticky} props={{ title: 'x' }} />, { registry }))

    expect(hostBox(container).className).toBe('relative z-20 md:sticky md:top-0 flex min-h-0 flex-1 flex-col')
    expect(hostBox(container).getAttribute('style')).toBe('min-block-size: 30px;')
  })

  it('keeps the box, empty, while the implementation suspends', () => {
    const Suspended = lazy(() => new Promise<{ default: (props: HeaderProps) => ReactNode }>(() => {}))
    const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    registry.register(Header, { id: DEFAULT_ID, title: 'Task header', capabilities: ['shows-title'], component: Suspended })
    const { container } = render(tree(header(), { registry }))

    const box = hostBox(container)
    expect(box.dataset.state).toBe('resolved')
    expect(box.childNodes).toHaveLength(0)
  })
})

describe('ComponentsProvider', () => {
  it('makes useComponentRegistry and ComponentHost throw outside it', () => {
    expect(() => renderHook(() => useComponentRegistry())).toThrow(/ComponentsProvider/)
    expect(() => render(header())).toThrow(/ComponentsProvider/)
  })

  it('hands the tree the registry it was given, read once', () => {
    const { registry } = fixture()
    const { result, rerender } = renderHook(() => useComponentRegistry(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ComponentsProvider registry={registry}>{children}</ComponentsProvider>
      ),
    })

    rerender()

    expect(result.current).toBe(registry)
  })

  it('builds a registry of its own when given none', () => {
    const { result } = renderHook(() => useComponentRegistry(), {
      wrapper: ({ children }: { children: ReactNode }) => <ComponentsProvider>{children}</ComponentsProvider>,
    })

    expect(typeof result.current.subscribe).toBe('function')
    expect(result.current.list(Header.id)).toEqual([])
  })

  it('reports through one toast and one [cezar:extensions] line by default', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    render(
      <>
        {tree(
          <>
            {header('task-1')}
            {header('task-2')}
          </>,
          { registry, preferenceOf: prefer(JIRA_ID) },
        )}
        <Toaster />
      </>,
    )

    expect(screen.getAllByText('Jira header stopped working. Showing Cezar’s default task header.')).toHaveLength(1)
    expect(extensionLines(consoleError)).toEqual([
      `[cezar:extensions] ${JIRA_ID} (acme.jira) failed while rendering; showing ${DEFAULT_ID} instead`,
    ])
  })

  it('swallows a throwing reporter and still renders core’s default', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    render(
      tree(header(), {
        registry,
        preferenceOf: prefer(JIRA_ID),
        onImplementationError: () => {
          throw new Error('reporter bug')
        },
      }),
    )

    expect(screen.getByTestId('core-header')).toBeTruthy()
  })
})

/** What the shell around a slot reads: the implementation the host renders now. */
function HostedProbe({ subject = 'task-1' }: { subject?: string }) {
  const hosted = useHostedComponent(Header, subject)
  return <output data-testid={`hosted-${subject}`}>{hosted === null ? 'null' : hosted.componentId}</output>
}

/** The host and the probe for one subject, side by side. */
const hostAndProbe = (subject = 'task-1') => (
  <>
    {header(subject)}
    <HostedProbe subject={subject} />
  </>
)

describe('useHostedComponent: what the host renders now', () => {
  const named = (subject = 'task-1') => screen.getByTestId(`hosted-${subject}`).textContent

  it('names core’s default without a preference, and the preferred implementation with one', () => {
    const { registry } = fixture()
    const { container, rerender } = render(tree(hostAndProbe(), { registry }))
    expect(named()).toBe(DEFAULT_ID)
    expect(hostBox(container).dataset.component).toBe(named())

    rerender(tree(hostAndProbe(), { registry, preferenceOf: prefer(JIRA_ID) }))
    expect(named()).toBe(JIRA_ID)
    expect(hostBox(container).dataset.component).toBe(named())
  })

  it('names core’s default for the subject whose implementation threw, and only for that one', () => {
    const { registry } = fixture()
    behaviour.jira = 'render'
    const onImplementationError = vi.fn()
    const { container, rerender } = render(
      tree(hostAndProbe('task-1'), { registry, preferenceOf: prefer(JIRA_ID), onImplementationError }),
    )
    expect(named('task-1')).toBe(DEFAULT_ID)
    expect(hostBox(container).dataset.component).toBe(DEFAULT_ID)

    behaviour.jira = 'ok'
    rerender(
      tree(
        <>
          {hostAndProbe('task-1')}
          {hostAndProbe('task-2')}
        </>,
        { registry, preferenceOf: prefer(JIRA_ID), onImplementationError },
      ),
    )
    expect(named('task-1')).toBe(DEFAULT_ID)
    expect(named('task-2')).toBe(JIRA_ID)
    expect(hostBox(container, 1).dataset.component).toBe(JIRA_ID)
  })

  it('names core’s default after the chosen implementation is disposed', () => {
    const { registry, jiraHandle } = fixture()
    const { container } = render(tree(hostAndProbe(), { registry, preferenceOf: prefer(JIRA_ID) }))
    expect(named()).toBe(JIRA_ID)

    act(() => jiraHandle.dispose())
    expect(named()).toBe(DEFAULT_ID)
    expect(hostBox(container).dataset.component).toBe(DEFAULT_ID)
  })

  it('is null while the contract is unresolved', () => {
    const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    const { container } = render(tree(hostAndProbe(), { registry }))

    expect(named()).toBe('null')
    expect(hostBox(container).dataset.state).toBe('unresolved')
    expect(hostBox(container).dataset.component).toBeUndefined()
  })

  it('carries the implementation’s checked capabilities, never the list it declared', () => {
    // A contract with an optional capability, and an implementation that also declares a name the
    // contract does not know: the checked list keeps the optional one and drops the unknown one.
    const Rich = defineComponentContract<HeaderProps>('cezar.fixture.rich-header', {
      version: 1,
      requiredCapabilities: ['shows-title'],
      optionalCapabilities: ['shows-meta'],
    })
    const registry = createComponentRegistry({ contracts: [Rich], onDiagnostic: () => {} })
    registry.register(Rich, { id: 'cezar.fixture.rich-header.default', title: 'Rich header', capabilities: ['shows-title'], component: CoreHeader })
    registry.forExtension(fakeScope('acme.rich').scope).provide(Rich, {
      id: 'acme.rich.header',
      title: 'Acme header',
      capabilities: ['shows-title', 'shows-meta', 'shows-weather'],
      component: JiraHeader,
    })
    const { result } = renderHook(() => useHostedComponent(Rich, 'task-1'), {
      wrapper: ({ children }) =>
        tree(children, { registry, preferenceOf: (contractId) => (contractId === Rich.id ? 'acme.rich.header' : null) }),
    })

    expect(result.current?.componentId).toBe('acme.rich.header')
    expect(result.current?.capabilities).toEqual(['shows-title', 'shows-meta'])
  })
})
