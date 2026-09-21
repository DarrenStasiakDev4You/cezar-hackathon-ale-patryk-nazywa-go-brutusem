import { TaskComposer, TaskHeaderMain, TaskMetadata } from '@open-mercato/cezar-extension-api'

import { definePage, type PageDefinition } from './definitions'

/**
 * The first core page catalog entry. The live task route consumes only the schema-backed header and
 * composer boundaries; transcript, metadata and shell-owned controls remain outside this catalog
 * renderer. Keeping that split declarative prevents the generic renderer from becoming task-aware.
 */
export const TaskPage: PageDefinition = definePage({
  id: 'task.page',
  version: 1,
  zones: [
    {
      id: 'task.header',
      placement: 'task.header.main',
      accepts: [TaskHeaderMain],
      cardinality: 'single',
      required: true,
      layout: { minBlockSize: 30 },
    },
    {
      id: 'task.main',
      placement: 'task.main.content',
       accepts: [TaskComposer, TaskMetadata],
      cardinality: 'many',
      required: true,
      layout: { sizing: 'fill' },
    },
    { id: 'task.sidebar', placement: 'task.sidebar.panel', cardinality: 'many', required: false },
  ],
})
