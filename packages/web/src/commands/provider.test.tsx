import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineCommand, isExtensionError, TaskArchive } from '@open-mercato/cezar-extension-api'

import { CommandsProvider, useCommand, useCommands } from './provider'
import { createCommandRegistry, type CommandRegistry } from './registry'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const Greet = defineCommand<[input: { readonly name: string }], string>('cezar.test.greet')

function wrapper(queryClient: QueryClient, registry?: CommandRegistry) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CommandsProvider registry={registry}>{children}</CommandsProvider>
    </QueryClientProvider>
  )
}

/** A registry with one `cezar.test.greet` whose answer the test releases by hand. */
function gatedRegistry() {
  const registry = createCommandRegistry()
  let release!: () => void
  let refuse!: (error: Error) => void
  registry.register(
    Greet,
    ({ name }) =>
      new Promise<string>((resolve, reject) => {
        release = () => resolve(`Hello, ${name}!`)
        refuse = reject
      }),
    { visibility: 'internal', validate: (args): [{ name: string }] => [args[0] as { name: string }] },
  )
  return { registry, release: () => release(), refuse: (error: Error) => refuse(error) }
}

describe('useCommand', () => {
  it('is pending while the handler runs, then carries its result', async () => {
    const { registry, release } = gatedRegistry()
    const { result } = renderHook(() => useCommand(Greet), { wrapper: wrapper(new QueryClient(), registry) })

    act(() => result.current.mutate({ name: 'Ada' }))
    await waitFor(() => expect(result.current.isPending).toBe(true))

    act(() => release())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe('Hello, Ada!')
  })

  it('surfaces the CommandError on failure, with the handler’s own words', async () => {
    const { registry, refuse } = gatedRegistry()
    const onError = vi.fn()
    const { result } = renderHook(() => useCommand(Greet), { wrapper: wrapper(new QueryClient(), registry) })

    act(() => result.current.mutate({ name: 'Ada' }, { onError }))
    await waitFor(() => expect(result.current.isPending).toBe(true))
    act(() => refuse(new Error('greeter is asleep')))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isExtensionError(result.current.error, 'command-failed')).toBe(true)
    expect(result.current.error?.message).toBe('greeter is asleep')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('fires the hook-level callbacks for every run', async () => {
    const { registry, refuse } = gatedRegistry()
    const onError = vi.fn()
    const { result } = renderHook(() => useCommand(Greet, { onError }), {
      wrapper: wrapper(new QueryClient(), registry),
    })

    act(() => result.current.mutate({ name: 'Ada' }))
    await waitFor(() => expect(result.current.isPending).toBe(true))
    act(() => refuse(new Error('greeter is asleep')))

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(isExtensionError(onError.mock.calls[0]?.[0], 'command-failed')).toBe(true)
  })
})

describe('CommandsProvider', () => {
  it('without a registry, registers the core commands bound to the nearest QueryClient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'r1', archived: true }), { headers: { 'content-type': 'application/json' } }),
      ),
    )
    const queryClient = new QueryClient()
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => ({ commands: useCommands(), archive: useCommand(TaskArchive) }), {
      wrapper: wrapper(queryClient),
    })

    expect(result.current.commands.has(TaskArchive)).toBe(true)
    act(() => result.current.archive.mutate({ taskId: 'r1' }))

    await waitFor(() => expect(result.current.archive.data).toEqual({ taskId: 'r1', archived: true }))
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ['default', 'runs'] })
  })

  it('hands down the registry it is given', () => {
    const { registry } = gatedRegistry()
    const { result } = renderHook(() => useCommands(), { wrapper: wrapper(new QueryClient(), registry) })

    expect(result.current.has(Greet)).toBe(true)
    expect(result.current.has(TaskArchive)).toBe(false)
  })
})

describe('useCommands', () => {
  it('throws outside CommandsProvider, naming it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useCommands())).toThrow('useCommands must be used inside <CommandsProvider>')
  })
})
