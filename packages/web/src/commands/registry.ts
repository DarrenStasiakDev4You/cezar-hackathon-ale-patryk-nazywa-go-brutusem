import {
  isValidContributionId,
  type CommandOptions,
  type Commands,
  type CommandToken,
  type ContributionId,
  type Disposable,
  type ExtensionErrorCode,
} from '@open-mercato/cezar-extension-api'

import type { ExtensionScope } from '../extensions/registry'

/**
 * The cockpit's command registry (spec `.ai/specs/2026-09-19-command-api.md`): one handler per
 * command id, and the controlled-error pipeline every call goes through.
 *
 * PURE on purpose, like `extensions/registry.ts`: the extension API is its only runtime import —
 * no React, no DOM, no module-level state — so it runs unchanged under vitest and outside React
 * (a shortcut, an extension). Core uses it directly: it registers only `cezar.*` ids, each with an
 * explicit visibility and an input validator, and can execute every command. Each extension
 * activation gets `forExtension(scope)` — the `Commands` it sees as `context.commands`.
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
    handler: (...args: A) => NoInfer<R> | Promise<NoInfer<R>>,
    options: CoreCommandOptions<A>,
  ): Disposable
  /** Core execution: sees every command. Never throws; rejects only with a `CommandError`. */
  execute<A extends readonly unknown[], R>(command: CommandToken<A, R>, ...args: A): Promise<R>
  /** Core view: every registered command. Never throws. */
  has<A extends readonly unknown[], R>(command: CommandToken<A, R> | ContributionId): boolean
  /**
   * The `Commands` one extension activation sees as `context.commands`. Every method first calls
   * `scope.assertLive()` (so it fails with `disposed` after deactivation); `register` accepts only
   * ids under `${extension.id}.` and goes through `scope.track()`; `execute` and `has` see public
   * core commands plus every extension's commands — an internal core command answers as if it
   * did not exist.
   */
  forExtension(scope: ExtensionScope): Commands
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
const DEFAULT_TIMEOUT_MS = 30_000
/** `setTimeout`'s ceiling: a longer delay — `Infinity` included — overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647
const VISIBILITIES: readonly unknown[] = ['public', 'internal'] satisfies CommandVisibility[]
const INVALID_TOKEN = 'Invalid command: expected { kind: "command", id } with a valid contribution id'

/** One registered handler, and who may run it. Compared by identity when disposed. */
interface Registration {
  readonly id: ContributionId
  readonly handler: (...args: readonly unknown[]) => unknown
  readonly title: string | undefined
  /** Extension commands are always `public`: every extension may run them. */
  readonly visibility: CommandVisibility
  /** Present for core commands; extension handlers validate their own input. */
  readonly validate: ((args: readonly unknown[]) => readonly unknown[]) | undefined
  /** The providing extension; `undefined` for core. Only extension handlers are time-limited. */
  readonly extensionId: string | undefined
}

type Visible = (registration: Registration) => boolean
const everything: Visible = () => true
const publicOnly: Visible = (registration) => registration.visibility === 'public'

export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
  const timeoutMs = resolveTimeout(options.timeoutMs)
  const registrations = new Map<ContributionId, Registration>()

  const find = (command: unknown, visible: Visible): Registration | undefined => {
    const id = typeof command === 'string' ? validId(command) : tokenId(command)
    const registration = id === undefined ? undefined : registrations.get(id)
    return registration !== undefined && visible(registration) ? registration : undefined
  }

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
  const run = async (command: unknown, args: readonly unknown[], visible: Visible): Promise<unknown> => {
    const id = tokenId(command)
    if (id === undefined) throw new CommandError('invalid-id', INVALID_TOKEN)
    const registration = registrations.get(id)
    if (registration === undefined || !visible(registration)) {
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

    const call = invoke(() => registration.handler(...input))
    const outcome = await settle(call, registration.extensionId === undefined ? undefined : timeoutMs)
    if (outcome.ok) return outcome.value
    if (outcome.timedOut) {
      throw new CommandError('command-timeout', `Command "${id}" did not finish within ${timeoutMs} ms`, {
        commandId: id,
      })
    }
    // Wrapped even when the handler threw a coded error of its own: the code describes the call
    // the caller made, not something the handler called.
    throw new CommandError('command-failed', messageOf(outcome.error), { commandId: id, cause: outcome.error })
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
        extensionId: undefined,
      })
    },

    execute(command, ...args) {
      return run(command, args, everything) as Promise<never>
    },

    has(command) {
      return find(command, everything) !== undefined
    },

    forExtension(scope) {
      const extensionId = scope.extension.id
      const prefix = `${extensionId}.`
      return Object.freeze<Commands>({
        register(command, handler, commandOptions) {
          scope.assertLive()
          const id = tokenId(command)
          if (id === undefined) throw new CommandError('invalid-id', INVALID_TOKEN)
          if (!id.startsWith(prefix)) {
            throw new CommandError(
              'namespace-violation',
              `Extension "${extensionId}" may only register commands under "${prefix}", not "${id}"`,
              { commandId: id },
            )
          }
          if (typeof handler !== 'function') {
            throw new CommandError('invalid-input', `The handler for command "${id}" is not a function`, {
              commandId: id,
            })
          }
          if (registrations.has(id)) {
            throw new CommandError('duplicate-registration', `Command "${id}" is already registered`, {
              commandId: id,
            })
          }
          return scope.track(
            add({
              id,
              handler: handler as Registration['handler'],
              title: titleOf(commandOptions),
              visibility: 'public',
              validate: undefined,
              extensionId,
            }),
          )
        },

        async execute(command, ...args) {
          // Inside the async body: a `disposed` from an ended activation becomes the rejection.
          scope.assertLive()
          return run(command, args, publicOnly) as Promise<never>
        },

        has(command) {
          scope.assertLive()
          return find(command, publicOnly) !== undefined
        },
      })
    },
  }
}

/** Calls `fn` and turns a synchronous throw into a rejection. */
function invoke(fn: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(fn())
  } catch (error) {
    return Promise.reject(error)
  }
}

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly timedOut: false; readonly error: unknown }
  | { readonly ok: false; readonly timedOut: true }

/** Never rejects. With a limit, a call that outlives it settles as a timeout; its late result is ignored. */
function settle(call: Promise<unknown>, ms: number | undefined): Promise<Outcome> {
  return new Promise((resolve) => {
    const timer = ms === undefined ? undefined : setTimeout(() => resolve({ ok: false, timedOut: true }), ms)
    call.then(
      (value) => {
        clearTimeout(timer)
        resolve({ ok: true, value })
      },
      (error: unknown) => {
        clearTimeout(timer)
        resolve({ ok: false, timedOut: false, error })
      },
    )
  })
}

function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || Number.isNaN(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(timeoutMs, 0), MAX_TIMEOUT_MS)
}

/** `options.title` when it is a string — read defensively, the options come from extension code. */
function titleOf(options: unknown): string | undefined {
  try {
    const title = (typeof options === 'object' && options !== null ? options : {}) as { title?: unknown }
    return typeof title.title === 'string' ? title.title : undefined
  } catch {
    return undefined
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
