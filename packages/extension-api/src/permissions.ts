/**
 * What an extension may ask for. Requested in the manifest, approved by the user or host policy,
 * and enforced by the host. `network` is reserved: it protects nothing and is not a security
 * boundary.
 */
export type ExtensionPermission =
  | 'ui.components'
  | 'commands.execute'
  | 'storage'
  | 'events'
  | 'network'
  | 'notifications'
