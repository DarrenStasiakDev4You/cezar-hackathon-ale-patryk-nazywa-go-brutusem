import {
  TaskHeaderMain,
  TaskMetadata,
  type TaskHeaderMainProps,
  type TaskMetadataProps,
} from '@open-mercato/cezar-extension-api'

import type { AnyComponentContract } from './registry'

export interface CoreConformanceFixture {
  readonly contract: AnyComponentContract
  readonly props: object
}

const noop = (): void => {}

const headerProps: TaskHeaderMainProps = {
  task: {
    taskId: 'r1',
    projectId: 'p1',
    title: 'Do the thing',
    prompt: 'Summarize the project.',
    status: 'done',
    archived: false,
  },
  attention: { label: 'done', tone: 'success', pulse: false },
  engine: { runner: 'claude', model: 'auto' },
  meta: { workflow: 'quick-task', branch: 'cez/r1', diff: { added: 2, removed: 1, files: 1 } },
  actions: {
    continue: { available: true, enabled: true, pending: false },
    stop: { available: false, enabled: false, pending: false },
    archive: { available: true, enabled: true, pending: false },
    resolveConflicts: { available: false, enabled: false, pending: false },
    chooseEngine: { available: false, enabled: false, pending: false },
  },
  onContinue: noop,
  onStop: noop,
  onArchive: noop,
  onRename: noop,
  onResolveConflicts: noop,
  onNavigate: noop,
  onChooseEngine: noop,
}

const metadataProps: TaskMetadataProps = {
  task: { id: 'r1', projectId: 'p1', title: 'Do the thing' },
  metadata: {
    workflow: 'quick-task',
    branch: 'cez/r1',
    diff: { added: 2, removed: 1, files: 1 },
    engine: { runner: 'claude', model: 'auto' },
  },
  actions: {
    resolveConflicts: { available: false, enabled: false, pending: false },
    chooseEngine: { available: false, enabled: false, pending: false },
  },
  intents: {},
}

export const CORE_CONFORMANCE_FIXTURES: readonly CoreConformanceFixture[] = [
  { contract: TaskHeaderMain, props: headerProps },
  { contract: TaskMetadata, props: metadataProps },
]
