import { useMutation, useQueryClient, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'

import type { CommandToken } from '@open-mercato/cezar-extension-api'

import { registerCoreCommands } from './core-commands'
import { createCommandRegistry, type CommandRegistry } from './registry'

/**
 * React bindings for the command registry (spec `2026-09-19-command-api`, § React bindings). A
 * component runs a business action through `useCommand(token)` and keeps only presentation —
 * pending state, confirmation, toasts; the handler owns the request and the cache rule.
 */

const CommandsContext = createContext<CommandRegistry | null>(null)

/**
 * Hands the registry to the tree. Must sit inside `QueryClientProvider`.
 *
 * `registry` is the page's own (`main.tsx` builds it, so the extension host shares it); it is read
 * once, at mount. Omitted (tests) → one registry per provider, with the core commands bound to the
 * nearest QueryClient. StrictMode's double-invoke of the initializer is harmless: a registry and
 * its core registrations have no side effects outside the object.
 */
export function CommandsProvider(props: { readonly registry?: CommandRegistry; readonly children: ReactNode }) {
  const queryClient = useQueryClient()
  const [registry] = useState(() => {
    if (props.registry !== undefined) return props.registry
    const own = createCommandRegistry()
    registerCoreCommands(own, { queryClient })
    return own
  })
  return <CommandsContext.Provider value={registry}>{props.children}</CommandsContext.Provider>
}

/** The core view of the registry: every command. Throws when rendered outside CommandsProvider. */
export function useCommands(): Pick<CommandRegistry, 'execute' | 'has'> {
  const registry = useContext(CommandsContext)
  if (registry === null) throw new Error('useCommands must be used inside <CommandsProvider>')
  return registry
}

/** The presentation callbacks a component may attach to every run of a command. */
export type UseCommandOptions<I, R> = Pick<UseMutationOptions<R, Error, I>, 'onSuccess' | 'onError' | 'onSettled'>

/**
 * A mutation over one single-input command: `mutate(input)`, `isPending`, `onError`. Adds no cache
 * logic of its own — that lives in the handler. A failure is the registry's `CommandError`, whose
 * `message` is the handler's own words (for an API call, the server's). `options` are the mutation's
 * own callbacks, so — unlike those passed to `mutate` — they fire for every run, even after the
 * component unmounted.
 */
export function useCommand<I, R>(
  command: CommandToken<[input: I], R>,
  options: UseCommandOptions<I, R> = {},
): UseMutationResult<R, Error, I> {
  const commands = useCommands()
  return useMutation<R, Error, I>({ ...options, mutationFn: (input) => commands.execute(command, input) })
}
