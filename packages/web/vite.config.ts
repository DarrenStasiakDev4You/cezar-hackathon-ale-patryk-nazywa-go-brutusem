import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const appDir = dirname(fileURLToPath(import.meta.url))
const packagesDir = resolve(appDir, '..')

// The cockpit server (packages/cezar/src/server/server.ts) owns /api and serves the built app.
// `npm run dev` (scripts/dev.mjs) picks a free port and pins both processes to it via
// CEZ_API_PORT, so a stray cockpit already sitting on 4321 (another repo, an older install)
// can never end up behind the proxy. Standalone `npm run dev:web` keeps the 4321 default.
const API_TARGET = `http://127.0.0.1:${process.env.CEZ_API_PORT ?? 4321}`

// React DOM is large enough to push the otherwise route-split entry chunk over Vite's 500 kB
// warning threshold. Keep the tightly coupled React runtime in one stable, cacheable chunk
// rather than silencing the warning: future growth in either the app or vendor chunk stays
// visible. Module ids from Vite/Rolldown use forward slashes on every platform.
export const reactRuntimeChunk = {
  name: 'react-runtime',
  test: /node_modules\/(?:react(?:-dom)?|scheduler)\//,
}

/**
 * What core's defaults bring into the first paint (spec `.ai/specs/2026-09-19-component-host.md`).
 * `main.tsx` registers core's default of every served contract before the extension host starts,
 * so each one loads with the entry. That is only cheap while those modules stay small: through
 * their own static imports they must not pull the markdown stack or the rest of the run header out
 * of the task routes' lazy chunks.
 *
 * (The markdown stack reaches the first paint by another path today: the New task form's skill
 * detail renders markdown. That path predates this check and is not what it guards.)
 */
export const entryChunkRules = {
  /** Core's defaults: in the entry chunk, or in a chunk it imports statically. */
  eager: [
    /\/src\/routes\/task-thread\/core-task-header\.tsx$/,
    /\/src\/routes\/task-thread\/core-task-composer\.tsx$/,
  ],
  /** What a core default must not reach through its static imports. */
  keptOut: [/\/node_modules\/streamdown\//, /\/src\/routes\/task-thread\/run-header\.tsx$/],
}

/** The parts of an output chunk the check reads. Module ids use forward slashes on every platform. */
export interface BundledFile {
  readonly type: 'chunk' | 'asset'
  readonly isEntry?: boolean
  readonly imports?: readonly string[]
  readonly moduleIds?: readonly string[]
}

/** The build as the check reads it: the output chunks, and the module graph's static edges. */
export interface BuildGraph {
  readonly bundle: Readonly<Record<string, BundledFile>>
  /** A module's static imports (`this.getModuleInfo(id).importedIds`); dynamic ones stay out.
   *  `undefined` when the graph does not know the module. */
  readonly staticImportsOf: (moduleId: string) => readonly string[] | undefined
}

/**
 * What is wrong with the first paint, one line per problem; `[]` when nothing is. Every `eager`
 * module must be in the entry chunk or a chunk it imports statically (the chunks the browser
 * fetches before the first paint, which the Vite manifest lists as the entry's `imports`), and no
 * `keptOut` module may be reachable from one through static imports. It fails closed: an `eager`
 * module whose imports the graph cannot name is a problem, never a pass.
 */
export function entryChunkProblems(graph: BuildGraph, rules: typeof entryChunkRules = entryChunkRules): string[] {
  const { bundle } = graph
  const entries = Object.keys(bundle).filter((name) => bundle[name]?.type === 'chunk' && bundle[name]?.isEntry === true)
  if (entries.length === 0) return ['no entry chunk in the bundle']
  const eagerChunks = new Set<string>()
  const visitChunk = (fileName: string): void => {
    const file = bundle[fileName]
    if (eagerChunks.has(fileName) || file === undefined || file.type !== 'chunk') return
    eagerChunks.add(fileName)
    for (const imported of file.imports ?? []) visitChunk(imported)
  }
  for (const entry of entries) visitChunk(entry)
  const eagerModules = [...eagerChunks].flatMap((fileName) => bundle[fileName]?.moduleIds ?? [])

  const problems: string[] = []
  for (const rule of rules.eager) {
    const found = eagerModules.filter((id) => rule.test(id))
    if (found.length === 0) problems.push(`no module matching ${rule} loads with the entry`)
    for (const start of found) {
      // A core default always imports something (React, at least): no imports means the graph
      // could not be read, and a check that passes on nothing guards nothing.
      if ((graph.staticImportsOf(start) ?? []).length === 0) {
        problems.push(`the module graph names no static imports of ${start}, so nothing it pulls in can be checked`)
        continue
      }
      // Breadth-first over static imports, keeping the way back for the message.
      const cameFrom = new Map<string, string | null>([[start, null]])
      const queue = [start]
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const kept = rules.keptOut.find((keptOut) => keptOut.test(id))
        if (kept !== undefined) {
          const route: string[] = []
          for (let step: string | null = id; step !== null; step = cameFrom.get(step) ?? null) route.unshift(step)
          problems.push(`${start} pulls ${id} into the first paint: ${route.join(' → ')}`)
          continue
        }
        for (const next of graph.staticImportsOf(id) ?? []) {
          if (cameFrom.has(next)) continue
          cameFrom.set(next, id)
          queue.push(next)
        }
      }
    }
  }
  return problems
}

/** Fails `vite build` when {@link entryChunkProblems} finds anything. */
export function entryChunkGuard(): Plugin {
  return {
    name: 'cezar:entry-chunk-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const problems = entryChunkProblems({
        bundle: bundle as Readonly<Record<string, BundledFile>>,
        staticImportsOf: (moduleId) => this.getModuleInfo(moduleId)?.importedIds,
      })
      if (problems.length > 0) this.error(`the entry chunk check failed:\n- ${problems.join('\n- ')}`)
    },
  }
}

export default defineConfig({
  root: appDir,
  base: '/',
  // Tailwind v4 is CSS-first: the whole theme lives in src/styles/index.css, there is no tailwind.config.js.
  plugins: [react(), tailwindcss(), entryChunkGuard()],
  // `@/…` → packages/web/src — the alias shadcn/ui components import `cn` through. Mirrored in
  // tsconfig.json `paths`.
  //
  // The api-client resolves to its SOURCE, not to its published `dist`. The package builds
  // (for Node consumers and for npm) but nothing in the web toolchain should have to wait for
  // that build: aliasing to source keeps `npm run dev` a single step and gives HMR when the
  // contract changes. Vite maps the package's internal `./x.ts` specifiers directly. Mirrored
  // in tsconfig.json `paths`.
  //
  // The extension API resolves to source for the same reason (it has no build at all: its
  // `exports` names raw `.ts`). The workspace link would resolve it without the alias too;
  // `vite-config.test.ts` pins the alias so both spellings keep pointing at one file.
  resolve: {
    alias: {
      '@': resolve(appDir, 'src'),
      '@open-mercato/cezar-api-client': resolve(packagesDir, 'api-client/src/index.ts'),
      '@open-mercato/cezar-extension-api': resolve(packagesDir, 'extension-api/src/index.ts'),
    },
  },
  build: {
    // Built INTO the server package, because the CLI ships and serves it: `resolveWebDir()`
    // looks for `<pkg>/web/dist` next to its own `dist/`, and `files` puts it in the tarball.
    // A cross-package output is the honest expression of that coupling — the cockpit bundle is
    // an artifact of the service, not a separately shipped thing.
    outDir: resolve(packagesDir, 'cezar/web/dist'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [reactRuntimeChunk],
        },
      },
    },
  },
  server: {
    proxy: {
      // `ws: true` — /api/ws (the subscription socket) upgrades through the same proxy.
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
})
