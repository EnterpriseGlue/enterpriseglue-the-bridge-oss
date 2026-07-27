#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
)
const pinnedPackageManager = packageManifest.packageManager
const expectedIgnoredGhsas = ['GHSA-qwww-vcr4-c8h2']
const expectedHostRuntimeDependencies = {
  '@carbon/icons-react': '11.80.0',
  '@carbon/react': '1.107.0',
  '@carbon/styles': '1.106.0',
  react: '19.2.6',
  'react-dom': '19.2.6',
  'react-is': '19.2.6',
  'react-router-dom': '7.18.1',
}
const expectedSdkRuntimePeers = {
  '@carbon/icons-react': '11.80.0',
  '@carbon/react': '1.107.0',
  react: '19.2.6',
  'react-dom': '19.2.6',
  'react-is': '19.2.6',
  'react-router-dom': '7.18.1',
}
const workspaceConfigPath = join(repositoryRoot, 'pnpm-workspace.yaml')
const productionSourceRoots = [
  'frontend/src',
  'packages/frontend-host/src',
  'packages/plugin-reference/src',
  'packages/plugin-runtime/src',
  'packages/plugin-sdk/src',
]
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const excludedSourceNames = [
  /\.d\.ts$/,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:__tests__|fixtures|test)(?:\/|$)/,
]
const forbiddenRscPatterns = [
  {
    description: 'React Router RSC entry point',
    pattern: /react-router(?:-dom)?\/(?:dom-rsc|dom-static|route-module|react-server)/,
  },
  {
    description: 'React Router unstable RSC API',
    pattern: /\bunstable_[A-Za-z0-9_]*RSC[A-Za-z0-9_]*\b/,
  },
  {
    description: 'React Router RSC component or request API',
    pattern:
      /\b(?:RSCHydratedRouter|RSCStaticRouter|createCallServer|matchRSCServerRequest|routeRSCServerRequest)\b/,
  },
]

function fail(message) {
  console.error(`Production dependency audit failed: ${message}`)
  process.exit(1)
}

function collectSourceFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return []
  }

  const files = []
  for (const entry of readdirSync(rootPath)) {
    const entryPath = join(rootPath, entry)
    const entryStat = statSync(entryPath)
    if (entryStat.isDirectory()) {
      files.push(...collectSourceFiles(entryPath))
    } else if (sourceExtensions.has(extname(entryPath))) {
      files.push(entryPath)
    }
  }
  return files
}

function readApprovedAuditExceptions() {
  const workspaceConfig = readFileSync(workspaceConfigPath, 'utf8')
  const auditConfigMatch = workspaceConfig.match(
    /(?:^|\n)auditConfig:\s*\n([\s\S]*?)(?=\n\S|\s*$)/,
  )
  if (!auditConfigMatch) {
    return []
  }

  return [...auditConfigMatch[1].matchAll(/GHSA-[a-z0-9-]+/gi)]
    .map((match) => match[0])
    .filter((ghsa, index, all) => all.indexOf(ghsa) === index)
    .sort()
}

function readPackageManifest(repositoryPath) {
  return JSON.parse(readFileSync(join(repositoryRoot, repositoryPath), 'utf8'))
}

function assertExactDependencySet(label, actualDependencies, expectedDependencies) {
  for (const [dependency, expectedVersion] of Object.entries(expectedDependencies)) {
    const actualVersion = actualDependencies?.[dependency]
    if (actualVersion !== expectedVersion) {
      fail(
        `${label} must pin ${dependency} to ${expectedVersion}, found ${actualVersion ?? 'missing'}`,
      )
    }
  }
}

for (const hostManifestPath of ['frontend/package.json', 'packages/frontend-host/package.json']) {
  const hostManifest = readPackageManifest(hostManifestPath)
  assertExactDependencySet(
    `${hostManifestPath} plugin-visible runtime`,
    hostManifest.dependencies,
    expectedHostRuntimeDependencies,
  )
}

const pluginSdkManifest = readPackageManifest('packages/plugin-sdk/package.json')
assertExactDependencySet(
  'packages/plugin-sdk/package.json runtime peers',
  pluginSdkManifest.peerDependencies,
  expectedSdkRuntimePeers,
)
assertExactDependencySet(
  'packages/plugin-sdk/package.json development runtime',
  pluginSdkManifest.devDependencies,
  expectedSdkRuntimePeers,
)

const hostRuntimeSource = readFileSync(
  join(repositoryRoot, 'packages/backend-host/src/plugins/pluginRuntime.ts'),
  'utf8',
)
for (const expectedDeclaration of [
  "react: '19.2.6'",
  "reactDom: '19.2.6'",
  "router: '7.18.1'",
  "carbonReact: '1.107.0'",
]) {
  if (!hostRuntimeSource.includes(expectedDeclaration)) {
    fail(`backend host shared-runtime declaration is missing ${expectedDeclaration}`)
  }
}

const approvedAuditExceptions = readApprovedAuditExceptions()
const expectedExceptions = [...expectedIgnoredGhsas].sort()
if (JSON.stringify(approvedAuditExceptions) !== JSON.stringify(expectedExceptions)) {
  fail(
    `pnpm-workspace.yaml must contain exactly these reviewed GHSA exceptions: ${expectedExceptions.join(', ')}`,
  )
}

const productionSourceFiles = productionSourceRoots
  .flatMap((sourceRoot) => collectSourceFiles(join(repositoryRoot, sourceRoot)))
  .filter((sourcePath) => {
    const repositoryPath = relative(repositoryRoot, sourcePath).replaceAll('\\', '/')
    return !excludedSourceNames.some((pattern) => pattern.test(repositoryPath))
  })

const rscViolations = []
for (const sourcePath of productionSourceFiles) {
  const source = readFileSync(sourcePath, 'utf8')
  for (const forbidden of forbiddenRscPatterns) {
    if (forbidden.pattern.test(source)) {
      rscViolations.push(
        `${relative(repositoryRoot, sourcePath)} uses a forbidden ${forbidden.description}`,
      )
    }
  }
}
if (rscViolations.length > 0) {
  fail(
    `GHSA-qwww-vcr4-c8h2 is safe to suppress only while RSC is unreachable:\n${rscViolations.join('\n')}`,
  )
}

const frontendEntryPoint = readFileSync(
  join(repositoryRoot, 'packages/frontend-host/src/main.tsx'),
  'utf8',
)
if (
  !frontendEntryPoint.includes('createBrowserRouter') ||
  !frontendEntryPoint.includes('RouterProvider')
) {
  fail(
    'the frontend host must retain an explicit React Router Data Mode entry point before the RSC-only exception can remain approved',
  )
}

if (!/^pnpm@\d+\.\d+\.\d+$/.test(pinnedPackageManager)) {
  fail('package.json must pin an exact pnpm packageManager version')
}

const corepackExecutable = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const auditArguments = [
  pinnedPackageManager,
  'audit',
  '--audit-level',
  'high',
  '--json',
]
let audit = spawnSync(corepackExecutable, auditArguments, {
  cwd: repositoryRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    CI: 'true',
  },
  maxBuffer: 16 * 1024 * 1024,
})

if (audit.error?.code === 'ENOENT') {
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  audit = spawnSync(
    pnpmExecutable,
    ['audit', '--audit-level', 'high', '--json'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
      ...process.env,
      CI: 'true',
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  )
}

if (audit.error) {
  fail(`could not execute pnpm audit: ${audit.error.message}`)
}

let auditReport
try {
  auditReport = JSON.parse(audit.stdout)
} catch {
  const auditError = audit.stderr.trim()
  fail(`pnpm audit did not return valid JSON${auditError ? `: ${auditError}` : ''}`)
}

const vulnerabilityCounts = auditReport?.metadata?.vulnerabilities
if (!vulnerabilityCounts) {
  fail('pnpm audit returned no vulnerability metadata')
}

const high = Number(vulnerabilityCounts.high ?? 0)
const critical = Number(vulnerabilityCounts.critical ?? 0)
const actionableAdvisories = Object.values(auditReport.advisories ?? {}).filter(
  (advisory) => advisory.severity === 'high' || advisory.severity === 'critical',
)
if (actionableAdvisories.length > 0 || audit.status !== 0) {
  const affectedPackages = [
    ...new Set(actionableAdvisories.map((advisory) => advisory.module_name).filter(Boolean)),
  ].sort()
  fail(
    `${actionableAdvisories.length} actionable high/critical production advisories remain${
      affectedPackages.length > 0 ? ` in ${affectedPackages.join(', ')}` : ''
    }`,
  )
}

const reviewedSuppressedFindings = high + critical
if (reviewedSuppressedFindings !== expectedIgnoredGhsas.length) {
  fail(
    `expected ${expectedIgnoredGhsas.length} reviewed suppressed high/critical finding, but pnpm reported ${reviewedSuppressedFindings}; remove stale exceptions or investigate unreported findings`,
  )
}

console.log(
  `Production dependency audit passed: exact shared runtime; 0 actionable high/critical advisories; ${approvedAuditExceptions.length} narrowly guarded RSC-only exception; ${productionSourceFiles.length} production source files checked`,
)
