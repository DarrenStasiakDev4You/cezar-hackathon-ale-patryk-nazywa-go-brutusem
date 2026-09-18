import {
  isValidContributionId,
  type CommandOptions,
  type CommandToken,
  type ContributionId,
  type Disposable,
  type ExtensionErrorCode,
} from '@open-mercato/cezar-extension-api'

/**
 * The cockpit's command registry (spec `.ai/specs/2026-09-19-command-api.md`): one handler per
 * command id, and the controlled-error pipeline every call goes through.
 *
 * PURE on purpose, like `extensions/registry.ts`: the extension API is its only runtime import —
 * no React, no DOM, no module-level state — so it runs unchanged under vitest and outside React
 * (a shortcut, an extension). Core uses it directly: it registers only `cezar.*` ids, each with an
 * explicit visibility and an input validator, and can execute every command.
 */

export type CommandVisibility = 'public' | 'internal'

export interface CoreCommandOptions<A extends readonly unknown[]> extends CommandOptions {
  /** `internal`: invisible to extensions (`has` false, `execute` → `command-not-found`). No default. */
  readonly visibility: CommandVisibility
  /**
   * Turns untrusted arguments into typed ones; throw to refuse (→ `invalid-input` with that
   * message). The handler receives what this returns, never the caller's objects. Name the field
   * and the rule in the message, never the value — inputs may carry user content.
   */
  readonly validate: (args: readonly unknown[]) => NoInfer<A>
}

export interface CommandRegistry {
  /** Core registration: `cezar.*` ids only. Throws `invalid-id`, `namespace-violation`,
   *  `duplicate-registration`, or `invalid-input` for a non-function handler/validator. */
  register<A extends readonly unknown[], R>(
    command: CommandToken<A, R>,
    handler: (...args: A) => R | Promise<R>,
    options: CoreCommandOptions<A>,
  ): Disposable
  /** Core execution: sees every command. Never throws; rejects only with a `CommandError`. */
  execute<A extends readonly unknown[], R>(command: CommandToken<A, R>, ...args: A): Promise<R>
  /** Core view: every registered command. Never throws. */
  has<A extends readonly unknown[], R>(command: CommandToken<A, R> | ContributionId): boolean
}

export interface CommandRegistryOptions {
  /** Limit on each call into an extension-provided handler. Default 30_000 ms. */
  readonly timeoutMs?: number
}

/** Recognised by `isExtensionError` (duck-typed on `code`). */
export class CommandError extends Error {
  override readonly name = 'CommandError' as const
  readonly code: ExtensionErrorCode
  /** The id that was addressed, when there was a well-formed one. */
  readonly commandId?: ContributionId

  constructor(
    code: ExtensionErrorCode,
    message: string,
    options: { readonly commandId?: ContributionId; readonly cause?: unknown } = {},
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined)
    this.code = code
    if (options.commandId !== undefined) this.commandId = options.commandId
  }
}

const CORE_PREFIX = 'cezar.'
const VISIBILITIES: readonly unknown[] = ['public', 'internal'] satisfies CommandVisibility[]
const INVALID_TOKEN = 'Invalid command: expected { kind: "command", id } with a valid contribution id'

/** One registered handler, and who may run it. Compared by identity when disposed. */
interface Registration {
  readonly id: ContributionId
  readonly handler: (...args: readonly unknown[]) => unknown
  readonly title: string | undefined
  readonly visibility: CommandVisibility
  /** Present for core commands; extension handlers validate their own input. */
  readonly validate: ((args: readonly unknown[]) => readonly unknown[]) | undefined
}

export function createCommandRegistry(_options: CommandRegistryOptions = {}): CommandRegistry {
  const registrations = new Map<ContributionId, Registration>()

  /** Adds `registration`; the Disposable removes exactly it, once, and never a newer one. */
  const add = (registration: Registration): Disposable => {
    registrations.set(registration.id, registration)
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        if (registrations.get(registration.id) === registration) registrations.delete(registration.id)
      },
    }
  }

  // § Execution, precisely.
  const run = async (command: unknown, args: readonly unknown[]): Promise<unknown> => {
    const id = tokenId(command)
    if (id === undefined) throw new CommandError('invalid-id', INVALID_TOKEN)
    const registration = registrations.get(id)
    if (registration === undefined) {
      throw new CommandError('command-not-found', `Command "${id}" not found`, { commandId: id })
    }

    let input = args
    if (registration.validate !== undefined) {
      try {
        input = registration.validate(args)
        if (!Array.isArray(input)) throw new TypeError('the validator must return the argument list')
      } catch (error) {
        throw new CommandError('invalid-input', `Invalid input for ${id}: ${messageOf(error)}`, {
          commandId: id,
          cause: error,
        })
      }
    }

    try {
      return await registration.handler(...input)
    } catch (error) {
      // Wrapped even when the handler threw a coded error of its own: the code describes the
      // call the caller made, not something the handler called.
      throw new CommandError('command-failed', messageOf(error), { commandId: id, cause: error })
    }
  }

  return {
    register(command, handler, options) {
      const id = tokenId(command)
      if (id === undefined) throw new CommandError('invalid-id', INVALID_TOKEN)
      if (!id.startsWith(CORE_PREFIX)) {
        throw new CommandError('namespace-violation', `Core command "${id}" must be under "${CORE_PREFIX}"`, {
          commandId: id,
        })
      }
      if (typeof handler !== 'function') {
        throw new CommandError('invalid-input', `The handler for command "${id}" is not a function`, { commandId: id })
      }
      const { validate, visibility, title } = (options ?? {}) as Partial<CoreCommandOptions<readonly unknown[]>>
      if (typeof validate !== 'function') {
        throw new CommandError('invalid-input', `Core command "${id}" needs a validate function`, { commandId: id })
      }
      if (!VISIBILITIES.includes(visibility)) {
        throw new CommandError('invalid-input', `Core command "${id}" needs visibility "public" or "internal"`, {
          commandId: id,
        })
      }
      if (registrations.has(id)) {
        throw new CommandError('duplicate-registration', `Command "${id}" is already registered`, { commandId: id })
      }
      return add({
        id,
        handler: handler as Registration['handler'],
        title: typeof title === 'string' ? title : undefined,
        visibility: visibility as CommandVisibility,
        validate,
      })
    },

    execute(command, ...args) {
      return run(command, args) as Promise<never>
    },

    has(command) {
      const id = typeof command === 'string' ? validId(command) : tokenId(command)
      return id !== undefined && registrations.has(id)
    },
  }
}

/** The id of a well-formed command token, or `undefined` — never throws, whatever it is given. */
function tokenId(command: unknown): ContributionId | undefined {
  try {
    if (typeof command !== 'object' || command === null) return undefined
    const { kind, id } = command as { kind?: unknown; id?: unknown }
    return kind === 'command' && typeof id === 'string' ? validId(id) : undefined
  } catch {
    // A throwing getter or a Proxy trap: not a token.
    return undefined
  }
}

function validId(id: string): ContributionId | undefined {
  return isValidContributionId(id) ? id : undefined
}

/** The thrown value's message; a non-Error value is stringified. */
function messageOf(error: unknown): string {
  try {
    const message = (typeof error === 'object' && error !== null ? error : {}) as { message?: unknown }
    return typeof message.message === 'string' ? message.message : String(error)
  } catch {
    return 'a value that cannot be read was thrown'
  }
}
