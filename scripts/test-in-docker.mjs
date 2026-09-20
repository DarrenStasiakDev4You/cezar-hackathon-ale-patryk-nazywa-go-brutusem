#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const insideDocker = process.env.CEZ_TEST_IN_DOCKER === '1'
const dockerArgs = process.argv.slice(2)
if (insideDocker && dockerArgs[0] === '--inside') dockerArgs.shift()
const [flagOrMode = 'all', ...extraArgs] = dockerArgs

const packageRoots = {
  cezar: 'packages/cezar',
  web: 'packages/web',
  'api-client': 'packages/api-client',
  'extension-api': 'packages/extension-api',
}

const vitestBinary = resolve(repoRoot, 'node_modules/.bin/vitest')

function testFiles(packageName, directory) {
  const packageRoot = resolve(repoRoot, packageRoots[packageName])
  return readdirSync(resolve(packageRoot, directory))
    .filter((file) => file.endsWith('.test.ts'))
    .sort()
    .map((file) => resolve(packageRoot, directory, file))
}

function packageCommand(packageName, watch = false) {
  const packageRoot = resolve(repoRoot, packageRoots[packageName])
  return {
    cwd: packageRoot,
    command: vitestBinary,
    args: watch ? [] : ['run'],
  }
}

function commandFor(mode) {
  switch (mode) {
    case 'all':
      return { cwd: repoRoot, command: vitestBinary, args: ['run', ...extraArgs] }
    case 'all-watch':
      return { cwd: repoRoot, command: vitestBinary, args: extraArgs }
    case 'cezar':
      return { ...packageCommand('cezar'), args: ['run', ...extraArgs] }
    case 'cezar-watch':
      return { ...packageCommand('cezar', true), args: extraArgs }
    case 'web':
      return { ...packageCommand('web'), args: ['run', ...extraArgs] }
    case 'web-watch':
      return { ...packageCommand('web', true), args: extraArgs }
    case 'api-client':
      return { ...packageCommand('api-client'), args: ['run', ...extraArgs] }
    case 'api-client-watch':
      return { ...packageCommand('api-client', true), args: extraArgs }
    case 'extension-api':
      return { ...packageCommand('extension-api'), args: ['run', ...extraArgs] }
    case 'extension-api-watch':
      return { ...packageCommand('extension-api', true), args: extraArgs }
    case 'cezar-unit': {
      const files = testFiles('cezar', 'test/unit')
      return {
        cwd: resolve(repoRoot, packageRoots.cezar),
        command: process.execPath,
        args: ['--import', 'tsx', '--test', ...files, ...extraArgs],
      }
    }
    case 'cezar-package': {
      const files = testFiles('cezar', 'test/e2e')
      return {
        cwd: resolve(repoRoot, packageRoots.cezar),
        command: process.execPath,
        args: ['--import', 'tsx', '--test', ...files, ...extraArgs],
      }
    }
    case 'e2e':
      return { cwd: repoRoot, command: 'sh', args: ['.ai/scripts/e2e.sh', ...extraArgs] }
    default:
      throw new Error(`Unknown test target: ${mode}`)
  }
}

function run(command, env = process.env) {
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

function ensureDependencies() {
  const lockPath = resolve(repoRoot, 'package-lock.json')
  const nodeModules = resolve(repoRoot, 'node_modules')
  const markerPath = resolve(nodeModules, '.cezar-test-lock-hash')
  const lockHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex')
  let installedHash = ''
  try {
    installedHash = readFileSync(markerPath, 'utf8').trim()
  } catch {
    // The named Docker volume is empty on the first run.
  }
  if (installedHash === lockHash && existsSync(vitestBinary)) return
  // The e2e bootstrap also runs `npm ci`; it replaces node_modules but cannot know about
  // this runner's marker. Reuse that complete install instead of reinstalling on the next test.
  if (installedHash === '' && existsSync(vitestBinary) && existsSync(resolve(nodeModules, 'zod/package.json'))) {
    writeFileSync(markerPath, `${lockHash}\n`)
    return
  }

  const result = spawnSync('npm', ['ci'], { cwd: repoRoot, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  writeFileSync(markerPath, `${lockHash}\n`)
}

if (insideDocker) {
  ensureDependencies()
  run(commandFor(flagOrMode))
}

const image = 'cezar-test-runner:local'
const volumeKey = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12)

const build = spawnSync(
  'docker',
  ['build', '--file', 'docker/test.Dockerfile', '--tag', image, '.'],
  { cwd: repoRoot, stdio: 'inherit' },
)
if (build.error) throw new Error(`Docker is required to run tests: ${build.error.message}`)
if (build.status !== 0) process.exit(build.status ?? 1)

const dockerRunArgs = [
  'run',
  '--rm',
  '--init',
  '--shm-size=2g',
  '--env',
  'CEZ_TEST_IN_DOCKER=1',
  '--volume',
  `${repoRoot}:/workspace`,
  '--volume',
  `cezar-test-node-modules-${volumeKey}:/workspace/node_modules`,
  '--volume',
  `cezar-test-npm-${volumeKey}:/cache/npm`,
  '--volume',
  `cezar-test-browser-${volumeKey}:/cache/home/.cache`,
  '--env',
  'HOME=/cache/home',
  '--env',
  'NPM_CONFIG_CACHE=/cache/npm',
  '--workdir',
  '/workspace',
  image,
  '--inside',
  flagOrMode,
  ...extraArgs,
]

const uid = process.getuid?.()
const gid = process.getgid?.()
if (uid !== undefined && gid !== undefined) {
  const volumeMounts = [
    ['cezar-test-node-modules', '/workspace/node_modules'],
    ['cezar-test-npm', '/cache/npm'],
    ['cezar-test-browser', '/cache/home/.cache'],
  ]
  const ownership = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      '--volume',
      `${repoRoot}:/workspace`,
      ...volumeMounts.flatMap(([name, mount]) => [
        '--volume',
        `${name}-${volumeKey}:${mount}`,
      ]),
      image,
      '-c',
      `chown -R ${uid}:${gid} /workspace/node_modules /cache/npm /cache/home && find /workspace/packages -type d \\( -name node_modules -o -name dist \\) -prune -exec chown -R ${uid}:${gid} {} +`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (ownership.error) throw ownership.error
  if (ownership.status !== 0) process.exit(ownership.status ?? 1)
  dockerRunArgs.splice(4, 0, '--user', `${uid}:${gid}`)
}

if (process.env.CEZ_AGENT_MODELS_LOCKED === '1') {
  dockerRunArgs.splice(4, 0, '--env', 'CEZ_AGENT_MODELS_LOCKED=1')
}

if (flagOrMode.endsWith('-watch') || flagOrMode === 'all-watch') {
  dockerRunArgs.splice(1, 0, '--interactive')
  if (process.stdin.isTTY) dockerRunArgs.splice(2, 0, '--tty')
}

run({ cwd: repoRoot, command: 'docker', args: dockerRunArgs })
