/**
 * Where each core default lives, relative to `packages/web`, without an extension. Keep this pure
 * data so boundary checks, Vite's eager-entry guard and props-only scans agree on one list.
 */
export const CORE_IMPLEMENTATION_SOURCES: readonly { readonly contractId: string; readonly source: string }[] = [
  { contractId: 'cezar.task.header.main', source: 'src/routes/task-thread/core-task-header-main' },
]
