/** Stable route spellings for the workspace-level local extension API. */
export const EXTENSION_ROUTES = Object.freeze({
  inventory: '/extensions',
  diagnostics: '/extensions/diagnostics',
  endpoints: '/extensions/endpoints',
  approval: (id: string) => `/extensions/${encodeURIComponent(id)}/approval`,
  assets: (id: string, path: string) => `/extensions/${encodeURIComponent(id)}/assets/${path}`,
});
