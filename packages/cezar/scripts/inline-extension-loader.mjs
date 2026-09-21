/**
 * The local scanner uses the private extension-api package for its pure manifest gates. The CLI is
 * published, while extension-api is intentionally not on npm, so fold the scanner's runtime
 * dependency into the server build just like inline-contract.mjs does for the private contract.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const dist = new URL('../dist/', import.meta.url).pathname;
const entry = join(dist, 'extensions', 'local-loader.js');
if (!existsSync(entry) || !readFileSync(entry, 'utf8').includes('@open-mercato/cezar-extension-api')) {
  console.log('inline-extension-loader ok — nothing to bundle');
  process.exit(0);
}
const temporary = `${entry}.bundle`;
await build({ entryPoints: [entry], outfile: temporary, bundle: true, format: 'esm', platform: 'node', target: 'es2022', external: ['zod'] });
writeFileSync(entry, readFileSync(temporary));
unlinkSync(temporary);
console.log('inline-extension-loader ok — private extension-api folded into the published scanner');
