#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const allowedDocDirectories = new Set([
  'architecture',
  'assets',
  'concepts',
  'developer',
  'development',
  'examples',
  'how-to',
  'reference',
  'releases',
  'runbooks',
  'security',
])

const allowedAudiences = new Set(['architect', 'developer', 'maintainer', 'operator'])
const allowedLifecycles = new Set([
  'accepted',
  'as-built',
  'proposed-technical',
  'reference',
  'release',
])

const internalPathPattern = /(?:^|[-_/])(?:business-case|commercial|customer-docs-staging|customer-journey|customer-specific|future-product|marketplace-strategy|personas?|positioning|pricing|product-decisions?|product-requirements?|product-roadmap|product-scope|product-strategy|program-status|roadmaps?|ux-research|ux-review)(?:[-_/\.]|$)/i
const imagePattern = /\.(?:gif|jpe?g|png|webp)$/i
const markdownPattern = /\.md$/i

function stripQuotes(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseDocumentationMetadata(content) {
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  if (lines[0] !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null
  const metadata = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([a-z_]+):\s*(.*?)\s*$/)
    if (match) metadata[match[1]] = stripQuotes(match[2])
  }
  return metadata
}

function metadataViolations(path, metadata) {
  const violations = []
  if (metadata.doc_class !== 'technical') {
    violations.push({
      path,
      code: 'invalid-doc-class',
      message: 'Repository documentation must declare `doc_class: technical`.',
    })
  }
  if (metadata.publication !== 'github') {
    violations.push({
      path,
      code: 'invalid-publication',
      message: 'Repository documentation must declare `publication: github`.',
    })
  }
  const audiences = (metadata.audience || '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((value) => stripQuotes(value))
    .filter(Boolean)
  if (audiences.length === 0 || audiences.some((audience) => !allowedAudiences.has(audience))) {
    violations.push({
      path,
      code: 'invalid-audience',
      message: 'Repository documentation audience must be architect, developer, maintainer, or operator.',
    })
  }
  if (!allowedLifecycles.has(metadata.lifecycle)) {
    violations.push({
      path,
      code: 'invalid-lifecycle',
      message: 'Repository documentation lifecycle must be accepted, as-built, proposed-technical, reference, or release.',
    })
  }
  return violations
}

export function analyzeDocumentationBoundary(changes, readText) {
  const violations = []
  for (const change of changes) {
    const path = change.path.replaceAll('\\', '/')
    if (path.startsWith('docs/evidence/')) {
      violations.push({
        path,
        code: 'transient-evidence',
        message: 'Store transient screenshots and qualification evidence in CI or release artifacts, not `docs/evidence`.',
      })
      continue
    }
    if (change.isNew && path.startsWith('docs/') && imagePattern.test(path) && !path.startsWith('docs/assets/')) {
      violations.push({
        path,
        code: 'unscoped-image',
        message: 'Durable documentation images belong under `docs/assets`; transient evidence belongs in CI or release artifacts.',
      })
    }
    if (!markdownPattern.test(path)) continue
    if (internalPathPattern.test(path)) {
      violations.push({
        path,
        code: 'internal-document-path',
        message: 'This path identifies internal product or customer-draft material, which must remain outside Git.',
      })
    }
    if (!path.startsWith('docs/')) continue
    const relative = path.slice('docs/'.length)
    const topLevel = relative.split('/')[0]
    if (change.isNew && relative !== 'index.md' && !allowedDocDirectories.has(topLevel)) {
      violations.push({
        path,
        code: 'unsupported-doc-location',
        message: 'New repository documentation must use an approved technical documentation directory.',
      })
    }
    const metadata = parseDocumentationMetadata(readText(path))
    if (change.isNew && !metadata) {
      violations.push({
        path,
        code: 'missing-metadata',
        message: 'New repository Markdown must declare doc_class, audience, publication, and lifecycle front matter.',
      })
      continue
    }
    if (metadata) violations.push(...metadataViolations(path, metadata))
  }
  return violations
}

function gitLines(args, root, { optional = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    if (optional) return []
    throw new Error(`git ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`)
  }
}

export function collectDocumentationChanges(root, baseRef) {
  gitLines(['rev-parse', '--verify', `${baseRef}^{commit}`], root)
  const changed = new Map()
  const add = (paths, isNew) => {
    for (const path of paths) {
      const previous = changed.get(path)
      changed.set(path, { path, isNew: Boolean(isNew || previous?.isNew) })
    }
  }
  add(gitLines(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`], root), false)
  add(gitLines(['diff', '--name-only', '--diff-filter=ACR', `${baseRef}...HEAD`], root), true)
  add(gitLines(['diff', '--name-only', '--diff-filter=ACMR'], root), false)
  add(gitLines(['diff', '--name-only', '--diff-filter=ACR'], root), true)
  add(gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], root), false)
  add(gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACR'], root), true)
  add(gitLines(['ls-files', '--others', '--exclude-standard'], root, { optional: true }), true)
  return [...changed.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function parseArgs(argv) {
  const options = { baseRef: process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main' }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--') continue
    if (key !== '--base-ref') throw new Error(`Unknown option: ${key}`)
    const value = argv[index + 1]
    if (!value) throw new Error('Missing value for --base-ref')
    options.baseRef = value
    index += 1
  }
  return options
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const root = gitLines(['rev-parse', '--show-toplevel'], process.cwd())[0]
  const changes = collectDocumentationChanges(root, options.baseRef)
  const violations = analyzeDocumentationBoundary(
    changes,
    (path) => readFileSync(resolve(root, path), 'utf8'),
  )
  if (violations.length > 0) {
    console.error('[documentation-boundary] blocked')
    for (const violation of violations) {
      console.error(`- ${violation.path} [${violation.code}]: ${violation.message}`)
    }
    process.exitCode = 1
    return
  }
  const documentationChanges = changes.filter((change) =>
    change.path.startsWith('docs/') || markdownPattern.test(change.path))
  console.log(`[documentation-boundary] passed (${documentationChanges.length} changed documentation/evidence files checked)`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
