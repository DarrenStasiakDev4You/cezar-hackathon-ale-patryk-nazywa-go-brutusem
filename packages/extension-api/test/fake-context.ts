import type {
  CommandOptions,
  ComponentContract,
  ComponentImplementation,
  Disposable,
  ExtensionContext,
  ExtensionManifest,
  JsonValue,
} from '@open-mercato/cezar-extension-api'

// A RECORDING ExtensionContext for tests — test-only, never exported by the package.
//
// It deliberately implements none of the host semantics: no namespace enforcement, no
// duplicate detection, synchronous event recording instead of asynchronous delivery, and
// disposables that do nothing. Those belong to — and are tested by — the host-runtime item.
// What it does do is look everything up BY ID, as the host must, because each extension
// bundle carries its own copy of the tokens.

export interface RecordedCommand {
  readonly handler: (...args: never[]) => unknown
  readonly options: CommandOptions | undefined
}

export interface RecordedComponent {
  readonly contract: ComponentContract<unknown>
  readonly implementation: ComponentImplementation<never>
}

export interface FakeContext {
  readonly context: ExtensionContext
  readonly commands: Map<string, RecordedCommand>
  readonly emitted: Array<{ readonly id: string; readonly payload: unknown }>
  readonly storage: Map<string, JsonValue>
  /** Implementations by implementation id. */
  readonly components: Map<string, RecordedComponent>
}

const noop: Disposable = { dispose() {} }

export function createFakeContext(manifest: ExtensionManifest): FakeContext {
  const commands = new Map<string, RecordedCommand>()
  const emitted: Array<{ id: string; payload: unknown }> = []
  const storage = new Map<string, JsonValue>()
  const components = new Map<string, RecordedComponent>()

  const context: ExtensionContext = {
    extension: manifest,
    subscriptions: [],
    commands: {
      register(command, handler, options) {
        commands.set(command.id, { handler: handler as RecordedCommand['handler'], options })
        return noop
      },
      async execute(command, ...args) {
        const recorded = commands.get(command.id)
        if (recorded === undefined) throw new Error(`no handler recorded for ${command.id}`)
        return (await (recorded.handler as (...a: typeof args) => unknown)(...args)) as never
      },
      has(command) {
        return commands.has(typeof command === 'string' ? command : command.id)
      },
    },
    events: {
      on() {
        return noop
      },
      emit(event, ...payload) {
        emitted.push({ id: event.id, payload: payload[0] })
      },
    },
    storage: {
      async get(key) {
        return storage.get(key) as never
      },
      async set(key, value) {
        storage.set(key, value as JsonValue)
      },
      async delete(key) {
        storage.delete(key)
      },
      async keys() {
        return [...storage.keys()]
      },
    },
    components: {
      provide(contract, implementation) {
        components.set(implementation.id, {
          contract: contract as ComponentContract<unknown>,
          implementation: implementation as ComponentImplementation<never>,
        })
        return noop
      },
    },
  }

  return { context, commands, emitted, storage, components }
}
