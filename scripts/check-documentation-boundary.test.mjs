import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeDocumentationBoundary,
  parseDocumentationMetadata,
} from './check-documentation-boundary.mjs'

const technicalMetadata = `---
doc_class: technical
audience: developer, operator
publication: github
lifecycle: as-built
---
`

function analyze(changes, contents = {}) {
  return analyzeDocumentationBoundary(changes, (path) => contents[path] || '')
}

test('parses compact documentation governance front matter', () => {
  assert.deepEqual(parseDocumentationMetadata(technicalMetadata), {
    doc_class: 'technical',
    audience: 'developer, operator',
    publication: 'github',
    lifecycle: 'as-built',
  })
})

test('allows new technical documentation with approved metadata and location', () => {
  const path = 'docs/development/plugin-installation-specification.md'
  assert.deepEqual(analyze([{ path, isNew: true }], { [path]: technicalMetadata }), [])
})

test('allows an explicitly technical implementation plan', () => {
  const path = 'docs/architecture/plugin-runtime-implementation-plan.md'
  const content = technicalMetadata.replace('as-built', 'proposed-technical')
  assert.deepEqual(analyze([{ path, isNew: true }], { [path]: content }), [])
})

test('blocks new repository documentation without classification metadata', () => {
  const path = 'docs/development/undocumented-change.md'
  const violations = analyze([{ path, isNew: true }], { [path]: '# Missing metadata\n' })
  assert.ok(violations.some((violation) => violation.code === 'missing-metadata'))
})

test('grandfathers modified legacy technical documentation without metadata', () => {
  const path = 'docs/reference/configuration.md'
  assert.deepEqual(analyze([{ path, isNew: false }], { [path]: '# Existing reference\n' }), [])
})

test('blocks internal product and customer publication classifications', () => {
  const path = 'docs/architecture/product-roadmap.md'
  const content = technicalMetadata
    .replace('doc_class: technical', 'doc_class: internal-product')
    .replace('publication: github', 'publication: enterpriseglue.ai')
  const violations = analyze([{ path, isNew: true }], { [path]: content })
  for (const code of ['internal-document-path', 'invalid-doc-class', 'invalid-publication']) {
    assert.ok(violations.some((violation) => violation.code === code), `missing ${code}`)
  }
})

test('blocks transient screenshot evidence committed below docs', () => {
  const violations = analyze([
    { path: 'docs/evidence/plugin-manager/installed.png', isNew: true },
    { path: 'docs/development/plugin-manager.png', isNew: true },
  ])
  assert.ok(violations.some((violation) => violation.code === 'transient-evidence'))
  assert.ok(violations.some((violation) => violation.code === 'unscoped-image'))
})
