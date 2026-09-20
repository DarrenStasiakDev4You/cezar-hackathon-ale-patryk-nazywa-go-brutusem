import type { ComponentImplementation, ComponentProps, TaskMetadata } from '@open-mercato/cezar-extension-api'
import type { ReactElement } from 'react'

type Props = ComponentProps<typeof TaskMetadata>

/** A deliberately small implementation proving the metadata contract is not core-specific. */
function CompactTaskMetadata({ metadata, actions, intents }: Props): ReactElement {
  const references = metadata.references?.filter((reference) => reference.number !== undefined) ?? []
  const summary = [
    metadata.workflow,
    metadata.branch,
    metadata.diff === undefined ? undefined : `+${metadata.diff.added} -${metadata.diff.removed}`,
    references.length === 0 ? undefined : `${references.length} reference${references.length === 1 ? '' : 's'}`,
    `${metadata.engine.runner}/${metadata.engine.model}`,
  ].filter((part): part is string => part !== undefined)

  return (
    <div data-example="compact-task-metadata" data-slot="run-meta" className="truncate text-xs text-muted-foreground">
      <span>{summary.join(' · ')}</span>
      {intents.chooseEngine && actions.chooseEngine.available ? (
        <button type="button" className="ml-2 underline" onClick={intents.chooseEngine}>
          Choose engine
        </button>
      ) : null}
    </div>
  )
}

/** A second implementation of `cezar.task.metadata@1`, for tests only. */
export const compactTaskMetadata: ComponentImplementation<Props> = {
  id: 'test.compact-task-metadata.line',
  title: 'Compact line',
  capabilities: ['shows-metadata'],
  component: CompactTaskMetadata,
}
