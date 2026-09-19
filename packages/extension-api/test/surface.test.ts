import { describe, expect, it } from 'vitest'

// Imported by PACKAGE NAME, not by path: this proves the package resolves through the workspace
// link and its `exports` map exactly as an extension will import it.
import * as api from '@open-mercato/cezar-extension-api'

describe('@open-mercato/cezar-extension-api surface', () => {
  it('loads through its package name', () => {
    expect(api).toBeTypeOf('object')
  })

  // The runtime surface is a promise to every extension. Adding or removing an export must be a
  // deliberate edit of this list, never a side effect of a refactor. (Types are pinned by the
  // type tests; this list is what exists at runtime.)
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
      'ExtensionActivated',
      'ExtensionDefinitionError',
      'ProjectChanged',
      'TaskArchive',
      'TaskArchived',
      'TaskCancelled',
      'TaskCompleted',
      'TaskContinue',
      'TaskFailed',
      'TaskHeaderMain',
      'TaskStarted',
      'TaskStatusChanged',
      'TaskStop',
      'booleanSetting',
      'checkComponentCompatibility',
      'defineCommand',
      'defineComponentContract',
      'defineEvent',
      'defineExtension',
      'defineSettings',
      'isExtensionError',
      'isValidContributionId',
      'isValidExtensionId',
      'validateManifest',
    ])
  })
})
