import { createElement } from 'react'

import {
  TaskHeaderMain,
  booleanSetting,
  defineExtension,
  defineSettings,
  numberSetting,
  selectSetting,
  stringSetting,
  type ComponentImplementation,
  type ComponentProps,
  type ComponentRenderProps,
} from '@open-mercato/cezar-extension-api'

type HeaderProps = ComponentProps<typeof TaskHeaderMain>

const settings = defineSettings({
  scope: 'global',
  schema: {
    compact: booleanSetting({ default: false, label: 'Compact header' }),
    label: stringSetting({ default: 'Fixture header', label: 'Label', maxLength: 64 }),
    columns: numberSetting({ default: 2, label: 'Columns', min: 1, max: 4, integer: true }),
    tone: selectSetting({
      default: 'neutral',
      label: 'Tone',
      options: [
        { value: 'neutral', label: 'Neutral' },
        { value: 'accent', label: 'Accent' },
      ],
    }),
  },
})

type Settings = typeof settings.defaults
type Props = ComponentRenderProps<HeaderProps, Settings>

function ConfigurableHeader(props: Props) {
  const values = props.useComponentSettings()
  return createElement(
    'div',
    {
      'data-fixture': 'configurable-header',
      'data-compact': String(values.compact),
      'data-label': values.label,
      'data-columns': String(values.columns),
      'data-tone': values.tone,
    },
    values.label,
  )
}

const implementation: ComponentImplementation<HeaderProps, Settings> = {
  id: 'fixture.configurable-header.task-header',
  title: 'Configurable fixture header',
  capabilities: ['shows-title', 'shows-status', 'shows-meta'],
  settings,
  component: ConfigurableHeader,
}

export const configurableHeaderExtension = defineExtension({
  manifest: {
    id: 'fixture.configurable-header',
    name: 'Configurable header fixture',
    version: '1.0.0',
    engines: { cezar: '^0.11.0' },
    permissions: ['ui.components'],
  },
  activate(context) {
    context.components.provide(TaskHeaderMain, implementation)
  },
})

export { settings as configurableHeaderSettings }
