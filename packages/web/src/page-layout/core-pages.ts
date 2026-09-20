import { TaskComposer, TaskHeaderMain } from '@open-mercato/cezar-extension-api'

import { definePage, type PageDefinition } from './definitions'

/**
 * The first core page catalog entry. The task route is intentionally not wired to it yet: the
 * follow-up consumer will add the typed transcript and metadata contracts alongside its adapter.
 * Keeping the catalog declarative now makes the future route a data decision instead of a renderer
 * switch statement.
 */
export const TaskPage: PageDefinition = definePage({
  id: 'task.page',
  version: 1,
  zones: [
    { id: 'task.header', accepts: [TaskHeaderMain], cardinality: 'single', required: true, layout: { minBlockSize: 30 } },
    { id: 'task.main', accepts: [TaskComposer], cardinality: 'many', required: true, layout: { sizing: 'fill' } },
    { id: 'task.sidebar', accepts: [], cardinality: 'many', required: false },
  ],
})
