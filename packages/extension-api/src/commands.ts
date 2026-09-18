import type { ContributionId } from './ids.ts'
import type { IsJson } from './json.ts'
import type { Disposable } from './lifecycle.ts'
import { createToken } from './tokens.ts'

/**
 * A typed handle on a command id. The producer (who registers the handler) and every consumer
 * (who executes it) share the token and get compile-time checking of the arguments and result.
 * Created with {@link defineCommand}; any object of this shape with the same `id` addresses the
 * same command.
 */
export interface CommandToken<Args extends readonly unknown[] = [], Result = void> {
  readonly kind: 'command'
  readonly id: ContributionId
  /** Type-only phantom — never set at runtime. It is what makes tokens of different types distinct. */
  readonly __types?: (...args: Args) => Result
}

/**
 * Declares a command: `defineCommand<[name: string], string>('acme.hello.say-hello')`.
 *
 * Arguments and result must be JSON (see {@link IsJson}) — a function or `Date` among them makes
 * the id parameter `never`, a compile error here. Throws {@link ExtensionDefinitionError} (code
 * `invalid-id`) when the id is not a {@link ContributionId}. Returns a frozen `{ kind, id }`.
 */
export function defineCommand<Args extends readonly unknown[] = [], Result = void>(
  id: [IsJson<Args>, IsJson<Result>] extends [true, true] ? ContributionId : never,
): CommandToken<Args, Result> {
  return createToken<CommandToken<Args, Result>>({ kind: 'command', id })
}

export interface CommandOptions {
  /** When present, the host may list the command in the command palette under this title. */
  readonly title?: string
}

/**
 * Registering and executing commands. Host semantics:
 * - One handler per id — a second `register` fails with `duplicate-registration`.
 * - An extension registers only ids in its own namespace (`namespace-violation` otherwise).
 * - `execute` of an id nobody registered rejects with `command-not-found`.
 * - A throwing handler rejects the caller's promise and never takes down the host.
 */
export interface Commands {
  register<A extends readonly unknown[], R>(
    command: CommandToken<A, R>,
    handler: (...args: A) => R | Promise<R>,
    options?: CommandOptions,
  ): Disposable
  execute<A extends readonly unknown[], R>(command: CommandToken<A, R>, ...args: A): Promise<R>
}
