# Local Extensions

Cezar can load an unpacked frontend extension without rebuilding Cezar. This feature is available only when the cockpit is running locally.

## Install A Package

Place one package in a direct child directory of `~/.cezar/extensions/`:

```text
~/.cezar/extensions/acme.calendar/
  cezar.extension.json
  dist/frontend.js
```

The manifest must include a `publisher.name` id, a semver version, a Cezar release range, API generation `1`, and a package-relative JavaScript entrypoint:

```json
{
  "id": "acme.calendar",
  "name": "Calendar",
  "version": "1.0.0",
  "engines": { "cezar": "^0.11.0" },
  "cezar": { "apiVersion": 1 },
  "entrypoints": { "frontend": "./dist/frontend.js" },
  "permissions": ["events"]
}
```

Build the package before placing it in the directory. No Cezar source change or Cezar rebuild is required after the package is built.

## Permissions And Reloads

An extension with no requested permissions can load after the next inventory refresh. An extension that requests permissions stays inactive until **Settings -> Extensions -> Approve permissions** is used. Cezar stores the approved permission set in `~/.cezar/extension-grants.json`; it is separate from the package manifest and can be deleted to revoke approvals.

Approval changes take effect after **Reload cockpit**. Cezar does not hot-replace an active extension. Removing or changing a package also takes effect after a reload.

Only the frontend entrypoint and relative JavaScript module chunks are served. Backend entrypoints, archives, project-local packages, remote URLs, and package downloads are not supported.

## Trust Boundary

Local extensions are not sandboxed. Approved code runs in the cockpit browser origin and can use browser APIs or call local HTTP routes. Extension permissions control access to Cezar's extension services; they are not a security boundary. Install only packages you trust.

Hosted mode never scans the server operator's local extension directory and does not serve local extension assets.
