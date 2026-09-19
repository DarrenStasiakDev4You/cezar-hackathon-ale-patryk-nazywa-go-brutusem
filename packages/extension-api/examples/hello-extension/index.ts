import {
  defineCommand, defineComponentContract, defineEvent, defineExtension,
  type ComponentProps,
} from '@open-mercato/cezar-extension-api'

const Greeting = defineComponentContract<{ name: string }>('example.hello.greeting', {
  version: 1,
  requiredCapabilities: ['greets-by-name'],
})
const SayHello = defineCommand<[name: string], string>('example.hello.say-hello')
const Greeted = defineEvent<{ name: string; count: number }>('example.hello.greeted')

const LoudGreeting = ({ name }: ComponentProps<typeof Greeting>) => `HELLO, ${name.toUpperCase()}!`

export default defineExtension({
  manifest: { id: 'example.hello', name: 'Hello', version: '1.0.0', engines: { cezar: '>=0.11.1' } },
  activate(context) {
    context.commands.register(SayHello, async (name) => {
      const stored = await context.storage.get('count')
      const count = (typeof stored === 'number' ? stored : 0) + 1
      await context.storage.set('count', count)
      context.events.emit(Greeted, { name, count })
      return `Hello, ${name}!`
    }, { title: 'Hello: say hello' })
    context.components.provide(Greeting, {
      id: 'example.hello.loud', title: 'Loud greeting', capabilities: ['greets-by-name'], component: LoudGreeting,
    })
  },
})
