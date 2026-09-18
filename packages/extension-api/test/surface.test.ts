import { describe, expect, it } from 'vitest'

// Imported by PACKAGE NAME, not by path: this proves the package resolves through the workspace
// link and its `exports` map exactly as an extension will import it.
import * as api from '@open-mercato/cezar-extension-api'

describe('@open-mercato/cezar-extension-api surface', () => {
  it('loads through its package name', () => {
    expect(api).toBeTypeOf('object')
  })
})
