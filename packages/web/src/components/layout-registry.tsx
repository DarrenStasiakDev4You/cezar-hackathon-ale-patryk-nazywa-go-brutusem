import * as React from 'react'

import { LayoutRegistry } from '@/lib/layout-elements'

const LayoutRegistryContext = React.createContext<LayoutRegistry | null>(null)
const emptySnapshot: never[] = []
const emptySubscribe = (_listener: () => void): (() => void) => () => undefined

export function LayoutRegistryProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useState(() => new LayoutRegistry())[0]
  return <LayoutRegistryContext.Provider value={registry}>{children}</LayoutRegistryContext.Provider>
}

export function useLayoutRegistry(): LayoutRegistry {
  const registry = useOptionalLayoutRegistry()
  if (!registry) {
    throw new Error('useLayoutRegistry must be used inside LayoutRegistryProvider')
  }
  return registry
}

/** Optional counterpart for layout declarations rendered by isolated component previews. */
export function useOptionalLayoutRegistry(): LayoutRegistry | null {
  const registry = React.useContext(LayoutRegistryContext)
  // Subscribe here so discovery consumers re-render when a wrapper mounts, unmounts, or attaches
  // its visual node. The registry itself remains stable for the lifetime of the provider.
  React.useSyncExternalStore(
    registry ? registry.subscribe.bind(registry) : emptySubscribe,
    registry ? registry.getExternalSnapshot.bind(registry) : () => emptySnapshot,
    registry ? registry.getExternalSnapshot.bind(registry) : () => emptySnapshot,
  )
  return registry
}

export function useLayoutSnapshot() {
  return useLayoutRegistry().getSnapshot()
}
