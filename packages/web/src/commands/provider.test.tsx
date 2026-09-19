import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineCommand, isExtensionError, TaskArchive, TaskContinue } from '@open-mercato/cezar-extension-api'

import { useRuns } from '@/api/queries'

import { CommandsProvider, useCommand, useCommands, useTaskRefetch } from './provider'
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

describe('useTaskRefetch', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

  /** A server whose run-list answers the test releases one at a time; every request is counted. */
  function gatedRunsServer() {
    const requests: string[] = []
    const pending: Array<() => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = String(input)
        const method = init.method ?? 'GET'
        requests.push(`${method} ${path}`)
        if (method !== 'GET') return json({})
        return new Promise<Response>((resolve) => pending.push(() => resolve(json([]))))
      }),
    )
    return {
      runListRequests: () => requests.filter((request) => request === 'GET /api/v1/runs').length,
      requests,
      releaseRunList: () => {
        const release = pending.shift()
        if (release === undefined) throw new Error('no run-list request is waiting')
        release()
      },
    }
  }

  it('makes a command resolve only after the runs refetch settles, joining it instead of asking twice', async () => {
    const server = gatedRunsServer()
    const { result } = renderHook(
      () => {
        const refetchTask = useTaskRefetch()
        return {
          runs: useRuns(),
          resume: useCommand(TaskContinue, { onSuccess: (_result, input) => refetchTask(input) }),
        }
      },
      { wrapper: wrapper(new QueryClient()) },
    )
    await waitFor(() => expect(server.runListRequests()).toBe(1))
    act(() => server.releaseRunList())
    await waitFor(() => expect(result.current.runs.isSuccess).toBe(true))

    act(() => result.current.resume.mutate({ taskId: 'r1', text: 'Go on.' }))
    await waitFor(() => expect(server.runListRequests()).toBe(2))
    // The continue was accepted and the refetch is in flight: the command is still pending.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(result.current.resume.isPending).toBe(true)

    act(() => server.releaseRunList())

    await waitFor(() => expect(result.current.resume.isSuccess).toBe(true))
    expect(server.requests).toEqual(['GET /api/v1/runs', 'POST /api/v1/runs/r1/continue', 'GET /api/v1/runs'])
  })

  it('covers the three project keys when the task names its project', async () => {
    const queryClient = new QueryClient()
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useTaskRefetch(), { wrapper: wrapper(queryClient) })

    await act(() => result.current({ taskId: 'r1', projectId: 'web' }))

    expect(invalidated.mock.calls).toEqual([
      [{ queryKey: ['workspace', 'runs-index'] }, { cancelRefetch: false }],
      [{ queryKey: ['default', 'runs'] }, { cancelRefetch: false }],
      [{ queryKey: ['web', 'runs', 'list'] }, { cancelRefetch: false }],
    ])
  })
})

describe('useCommands', () => {
  it('throws outside CommandsProvider, naming it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useCommands())).toThrow('useCommands must be used inside <CommandsProvider>')
  })
})
