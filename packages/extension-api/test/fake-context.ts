import type {
  CommandOptions,
  ComponentContract,
  ComponentImplementation,
  ComponentRegistrationHandle,
  Disposable,
  ExtensionContext,
  ExtensionManifest,
  JsonValue,
  Notifications,
} from '@open-mercato/cezar-extension-api'

// A RECORDING ExtensionContext for tests — test-only, never exported by the package.
//
// It deliberately implements none of the host semantics: no namespace enforcement, no
// duplicate detection, synchronous event recording instead of asynchronous delivery (an emit is
// recorded, never delivered to the recorded listeners), and disposables that do nothing — only
// `off` removes a recorded listener. Those belong to — and are tested by — the host-runtime item.
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

export interface RecordedListener {
  readonly listener: (payload: never) => void
  readonly once: boolean
}

export interface FakeContext {
  readonly context: ExtensionContext
  readonly commands: Map<string, RecordedCommand>
  readonly emitted: Array<{ readonly id: string; readonly payload: unknown }>
  /** `on` and `once` subscriptions by event id, in subscription order; `off` removes them. */
  readonly listeners: Map<string, RecordedListener[]>
  readonly storage: Map<string, JsonValue>
  /** Implementations by implementation id. */
  readonly components: Map<string, RecordedComponent>
}

const noop: Disposable = { dispose() {} }

export function createFakeContext(manifest: ExtensionManifest): FakeContext {
  const commands = new Map<string, RecordedCommand>()
  const emitted: Array<{ id: string; payload: unknown }> = []
  const listeners = new Map<string, RecordedListener[]>()
  const listen = (id: string, listener: RecordedListener['listener'], once: boolean): Disposable => {
    listeners.set(id, [...(listeners.get(id) ?? []), { listener, once }])
    return noop
  }
  const storage = new Map<string, JsonValue>()
  const components = new Map<string, RecordedComponent>()

  const context: ExtensionContext = {
    extension: manifest,
    permissions: Object.freeze([...(manifest.permissions ?? [])]),
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
      on(event, listener) {
        return listen(event.id, listener as RecordedListener['listener'], false)
      },
      once(event, listener) {
        return listen(event.id, listener as RecordedListener['listener'], true)
      },
      off(event, listener) {
        const remaining = (listeners.get(event.id) ?? []).filter((recorded) => recorded.listener !== listener)
        if (remaining.length > 0) listeners.set(event.id, remaining)
        else listeners.delete(event.id)
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
      provide<P, Settings>(contract: ComponentContract<P>, implementation: ComponentImplementation<NoInfer<P>, Settings>): ComponentRegistrationHandle<Settings> {
        components.set(implementation.id, {
          contract: contract as ComponentContract<unknown>,
          implementation: implementation as ComponentImplementation<never>,
        })
        return { componentId: implementation.id, dispose: noop.dispose, async getSettings() { return undefined }, onSettingsChange: () => noop }
      },
    },
    notifications: {
      info(_message: string) {},
      warning(_message: string) {},
      error(_message: string) {},
    } satisfies Notifications,
  }

  return { context, commands, emitted, listeners, storage, components }
}
