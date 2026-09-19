import { describe, expect, it } from 'vitest'

import {
  checkComponentCompatibility,
  defineCommand,
  defineComponentContract,
  defineEvent,
  validateManifest,
  type ComponentProps,
} from '@open-mercato/cezar-extension-api'

import hello from '../examples/hello-extension/index.ts'
import { createFakeContext } from './fake-context.ts'

// The definition-of-done fixture: an extension written against the package alone, activated.
// The test declares its OWN tokens for the example's ids — the example exports none — which is
// exactly how two separately bundled copies of a token meet: by id, never by identity.
const SayHello = defineCommand<[name: string], string>('example.hello.say-hello')
const Greeted = defineEvent<{ name: string; count: number }>('example.hello.greeted')
const Greeting = defineComponentContract<{ name: string }>('example.hello.greeting', {
  version: 1,
  requiredCapabilities: ['greets-by-name'],
})

describe('the hello example extension', () => {
  it('is accepted by defineExtension — a valid, frozen manifest', () => {
    expect(hello.manifest.id).toBe('example.hello')
    expect(validateManifest(hello.manifest)).toEqual([])
    expect(Object.isFrozen(hello.manifest)).toBe(true)
  })

  it('activates and registers its command and component', async () => {
    const fake = createFakeContext(hello.manifest)
    await hello.activate(fake.context)

    expect([...fake.commands.keys()]).toEqual(['example.hello.say-hello'])
    expect(fake.commands.get(SayHello.id)?.options).toEqual({ title: 'Hello: say hello' })
    expect([...fake.components.keys()]).toEqual(['example.hello.loud'])
  })

  it('says hello, counts in storage and emits Greeted each time', async () => {
    const fake = createFakeContext(hello.manifest)
    await hello.activate(fake.context)

    await expect(fake.context.commands.execute(SayHello, 'Ada')).resolves.toBe('Hello, Ada!')
    await expect(fake.context.commands.execute(SayHello, 'Ada')).resolves.toBe('Hello, Ada!')

    expect(fake.emitted).toEqual([
      { id: Greeted.id, payload: { name: 'Ada', count: 1 } },
      { id: Greeted.id, payload: { name: 'Ada', count: 2 } },
    ])
    expect(fake.storage.get('count')).toBe(2)
  })

  it('reads storage defensively — a value an older version wrote does not break it', async () => {
    const fake = createFakeContext(hello.manifest)
    fake.storage.set('count', 'three')
    await hello.activate(fake.context)

    await fake.context.commands.execute(SayHello, 'Grace')
    expect(fake.emitted).toEqual([{ id: Greeted.id, payload: { name: 'Grace', count: 1 } }])
  })

  it('provides one implementation of its Greeting contract, bound to version 1', async () => {
    const fake = createFakeContext(hello.manifest)
    await hello.activate(fake.context)

    const loud = fake.components.get('example.hello.loud')
    expect(loud?.contract).toEqual(Greeting)
    expect(loud?.implementation.title).toBe('Loud greeting')
    const render = loud?.implementation.component as unknown as (props: ComponentProps<typeof Greeting>) => string
    expect(render({ name: 'Ada' })).toBe('HELLO, ADA!')
  })

  it('declares the capabilities its Greeting contract requires, and the check sees it', async () => {
    const fake = createFakeContext(hello.manifest)
    await hello.activate(fake.context)
    const loud = fake.components.get('example.hello.loud')
    if (loud === undefined) throw new Error('example.hello.loud was not provided')

    // As a host checks it: its own token, the implementation, then the token `provide` received.
    const outcome = checkComponentCompatibility(Greeting, loud.implementation, loud.contract)
    expect(outcome).toEqual({ compatible: true, issues: [], capabilities: ['greets-by-name'] })

    // Not vacuous: without its declaration the same implementation fails.
    const { capabilities: _declared, ...undeclared } = loud.implementation
    expect(checkComponentCompatibility(Greeting, undeclared, loud.contract).issues).toEqual([
      {
        code: 'missing-capability',
        message: 'example.hello.loud does not declare "greets-by-name", required by example.hello.greeting@1',
        capability: 'greets-by-name',
      },
    ])
  })
})
