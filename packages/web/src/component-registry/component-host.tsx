import {
  Component,
  createElement,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'

import type { ComponentContract, ComponentLayout } from '@open-mercato/cezar-extension-api'

import { Button } from '@/components/ui/button'

import { useComponentsRuntime } from './provider'
import type { ComponentRegistration, UsableComponent } from './registry'
import { resolveComponent, type ComponentResolution } from './resolve'

/**
 * The component host (spec `.ai/specs/2026-09-19-component-host.md`, § Hosting, precisely): the
 * runtime layer between core and a replaceable component. It renders what `resolveComponent`
 * answers for one contract, with the contract's props, inside its own error boundary and a box
 * sized by the contract's `layout`. An extension's implementation that throws while rendering, or
 * in an effect or lifecycle method, is replaced by core's default, and the provider reports it
 * once. The rest of the page keeps working. Errors in event handlers, promises and infinite loops
 * are not caught: the host isolates, it does not sandbox.
 */

export interface ComponentHostProps<P> {
  /** A served token from `CORE_COMPONENT_CONTRACTS`, e.g. `TaskHeaderMain`. */
  readonly contract: ComponentContract<P>
  /** What this host shows, e.g. the task id. A failure sets the implementation aside for this
   *  subject only. Default `''`: one subject per contract. */
  readonly subject?: string
  /** The contract's props, passed to the implementation as they are. */
  readonly props: P
}

type HostState = 'resolved' | 'fallback' | 'failed' | 'unresolved'

/** What the host for one (contract, subject) resolved, and which implementation it renders now. */
interface HostedChoice<P> {
  readonly resolution: ComponentResolution<P>
  /** The resolved component, or core's default once the resolved one failed for this subject;
   *  `null` while unresolved. */
  readonly current: UsableComponent<P> | null
}

/**
 * Steps 1, 2 and 4 of the host (spec `2026-09-19-component-host`, § Hosting, precisely): subscribe,
 * resolve, choose. One function, so `ComponentHost` and `useHostedComponent` make the same choice
 * from the provider's one failure record and cannot disagree.
 */
function useHostedChoice<P extends object>(contract: ComponentContract<P>, subject: string): HostedChoice<P> {
  const runtime = useComponentsRuntime()
  const { registry, hasFailed } = runtime

  // 1. Subscribe: an extension that activates or deactivates re-resolves every host.
  const revision = useSyncExternalStore(registry.subscribe, registry.revision)
  // 2. Resolve.
  const preference = runtime.preferenceOf(contract.id)
  const resolution = useMemo(
    () => resolveComponent(registry, contract, preference),
    // `revision` stands for the registry's contents, which the resolver reads.
    [registry, revision, contract, preference],
  )
  // 4. Choose: core's default once the resolved implementation failed for this subject.
  const current =
    resolution.status === 'unresolved'
      ? null
      : hasFailed(registrationOf(resolution.component), subject)
        ? resolution.fallback
        : resolution.component
  return { resolution, current }
}

/**
 * The implementation the host for (`contract`, `subject`) renders now: the resolved component, or
 * core's default once the resolved one has failed for this subject. `null` while unresolved.
 *
 * For core code around a slot that must follow what renders in it (spec
 * `2026-09-19-task-header-contract`: the task header's shell reads the checked `capabilities` of
 * the implementation it hosts). `ComponentHost` makes its choice through the same function.
 */
export function useHostedComponent<P extends object>(contract: ComponentContract<P>, subject = ''): UsableComponent<P> | null {
  return useHostedChoice(contract, subject).current
}

export function ComponentHost<P extends object>({ contract, subject = '', props }: ComponentHostProps<P>): ReactElement {
  const { recordFailure, reportDefaultFailure, reportUnresolved } = useComponentsRuntime()
  // 1, 2 and 4: subscribe, resolve, choose.
  const { resolution, current } = useHostedChoice(contract, subject)
  const [retry, setRetry] = useState(0)
  // The boundary whose core default threw (its key and subject), so the box can say `failed`.
  const [broken, setBroken] = useState<string | null>(null)

  const unresolved = resolution.status === 'unresolved'
  useEffect(() => {
    if (unresolved) reportUnresolved(contract.id)
  }, [unresolved, contract.id, reportUnresolved])

  const box = boxOf(contract.layout)

  // 3. Unresolved: a core bug the gate test forbids. Never an extension instead.
  if (resolution.status === 'unresolved' || current === null) {
    return <HostBox contractId={contract.id} state="unresolved" box={box} />
  }

  const { fallback } = resolution
  const isFallback = current === fallback
  const key = `${current.componentId}:${retry}`
  const identity = `${key}|${subject}`
  // Another boundary or another subject is on screen: the `failed` mark belonged to the one before,
  // so it goes (React's "adjust state while rendering" pattern, for this component's own state).
  if (broken !== null && broken !== identity) setBroken(null)

  const tryAgain = () => setRetry((count) => count + 1)
  const coreFailed = (error: unknown) => {
    reportDefaultFailure(registrationOf(fallback), error)
    setBroken(identity)
  }
  const failedNotice = <FailedNotice onRetry={tryAgain} />

  // 6. When an extension's implementation throws, its boundary renders core's default at once,
  //    inside a boundary of its own, and tells the provider, which sets it aside for this subject.
  //    That boundary reports nothing: the provider's record re-keys the host to core's default
  //    straight away, and that boundary reports if core's default throws too (one line, step 7).
  // 7. When core's default throws, the box shows the inline notice.
  const onFailed = isFallback
    ? failedNotice
    : (
        <ImplementationBoundary onCatch={IGNORE} failed={failedNotice} resetKey={subject}>
          <Suspense fallback={null}>{createElement(fallback.component, props)}</Suspense>
        </ImplementationBoundary>
      )
  const onCatch = isFallback
    ? coreFailed
    : (error: unknown) =>
        recordFailure({ registration: registrationOf(current), fallback: registrationOf(fallback), error }, subject)

  const state: HostState = broken === identity ? 'failed' : current !== resolution.component ? 'fallback' : 'resolved'

  // 5. Render. A new component id or a retry changes the key, which remounts the boundary (step 8).
  //    A new subject resets a failed boundary without remounting a healthy one, so the next task
  //    tries core's default again.
  return (
    <HostBox contractId={contract.id} componentId={current.componentId} state={state} box={box}>
      <ImplementationBoundary key={key} onCatch={onCatch} failed={onFailed} resetKey={subject}>
        <Suspense fallback={null}>{createElement(current.component, props)}</Suspense>
      </ImplementationBoundary>
    </HostBox>
  )
}

/**
 * The registration a usable component is. `listUsable` hands out the registry's own objects, typed
 * with the contract's props, and `ComponentRegistration`'s `ComponentType<never>` does not accept
 * a class component typed with props, so only the type changes here.
 */
function registrationOf<P>(usable: UsableComponent<P>): ComponentRegistration {
  return usable as unknown as ComponentRegistration
}

function HostBox(props: {
  readonly contractId: string
  readonly componentId?: string
  readonly state: HostState
  readonly box: Box
  readonly children?: ReactNode
}) {
  return (
    <div
      data-slot="component-host"
      data-contract={props.contractId}
      data-component={props.componentId}
      data-state={props.state}
      className={props.box.className}
      style={props.box.style}
    >
      {props.children}
    </div>
  )
}

/** The inline message when core's default itself threw. */
function FailedNotice(props: { readonly onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-[30px] items-center gap-3 text-[13px] text-foreground">
      <span>This part of the page could not be displayed.</span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={props.onRetry}>
        Try again
      </Button>
    </div>
  )
}

interface BoundaryProps {
  /** Called from `componentDidCatch`, once per caught error: never during render. */
  readonly onCatch: (error: unknown) => void
  /** What renders once a child threw. */
  readonly failed: ReactNode
  /** A new value clears a failure without remounting (react-error-boundary's `resetKeys` rule). */
  readonly resetKey: string
  readonly children: ReactNode
}

const IGNORE = (): void => {}

/**
 * One implementation's error boundary. `getDerivedStateFromError` only flips it to failed, because
 * React may call it during render; the report runs in `componentDidCatch`. A new `key` remounts
 * it, and a new `resetKey` clears its failure.
 */
class ImplementationBoundary extends Component<BoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onCatch(error)
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.failed : this.props.children
  }
}

interface Box {
  readonly className: string | undefined
  readonly style: CSSProperties | undefined
}

/**
 * The box a contract's `layout` asks for, with the host's own responsive rules: `sticky` pins only
 * from `md` up, `fill` grows into the container, and `minBlockSize` is reserved while an
 * implementation loads, fails or is swapped. Unknown keys and values are ignored.
 */
export function boxOf(layout: ComponentLayout | undefined): Box {
  const classes: string[] = []
  if (layout?.sticky === 'top') classes.push('relative z-20 md:sticky md:top-0')
  else if (layout?.sticky === 'bottom') classes.push('md:sticky md:bottom-0')
  if (layout?.sizing === 'fill') classes.push('flex min-h-0 flex-1 flex-col')
  const size = layout?.minBlockSize
  const reserved = typeof size === 'number' && Number.isInteger(size) && size >= 0 ? size : undefined
  return {
    className: classes.length > 0 ? classes.join(' ') : undefined,
    style: reserved === undefined ? undefined : { minBlockSize: `${reserved}px` },
  }
}
