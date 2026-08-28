import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

function assertVersion(value, label) {
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact major.minor.patch version`)
  }
}

export function nextHostChartPatchVersion(version) {
  assertVersion(version, 'Base chart version')
  const [major, minor, patch] = version.split('.').map(Number)
  if (!Number.isSafeInteger(patch) || patch === Number.MAX_SAFE_INTEGER) {
    throw new Error('Base chart patch version cannot be incremented safely')
  }
  return `${major}.${minor}.${patch + 1}`
}

export function updateHostChartReleaseVersion(source, { chartVersion, appVersion }) {
  assertVersion(chartVersion, 'Chart version')
  assertVersion(appVersion, 'Application version')

  const chartMatches = source.match(/^version:[^\r\n]*$/gm) ?? []
  const appMatches = source.match(/^appVersion:[^\r\n]*$/gm) ?? []
  if (chartMatches.length !== 1 || appMatches.length !== 1) {
    throw new Error('Host Chart.yaml must contain exactly one top-level version and appVersion')
  }

  return source
    .replace(/^version:[^\r\n]*$/m, `version: ${chartVersion}`)
    .replace(/^appVersion:[^\r\n]*$/m, `appVersion: "${appVersion}"`)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--file', '--base-chart-version', '--app-version'].includes(flag) || !value) {
      throw new Error(`Invalid host-chart release-version argument: ${flag ?? '<missing>'}`)
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate host-chart release-version argument: ${flag}`)
    }
    values.set(flag, value)
  }
  for (const required of ['--file', '--base-chart-version', '--app-version']) {
    if (!values.has(required)) throw new Error(`Missing required argument: ${required}`)
  }
  return values
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const file = resolve(args.get('--file'))
  const chartVersion = nextHostChartPatchVersion(args.get('--base-chart-version'))
  const appVersion = args.get('--app-version')
  const source = await readFile(file, 'utf8')
  const updated = updateHostChartReleaseVersion(source, { chartVersion, appVersion })
  if (updated !== source) await writeFile(file, updated)
  process.stdout.write(`Synchronized host chart ${chartVersion} with OSS ${appVersion}.\n`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
