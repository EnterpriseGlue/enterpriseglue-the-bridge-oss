import assert from 'node:assert/strict'

export function validateDocumentationImpact(value) {
  assert.ok(value && ['required', 'none'].includes(value.impact), 'Declare customerDocumentation.impact as required or none.')
  assert.deepEqual(Object.keys(value).filter(key=>!['impact','owner','pages','reason'].includes(key)), [], 'Unexpected documentation impact fields.')
  assert.ok(typeof value.owner === 'string' && value.owner.trim() && value.owner !== 'unassigned', 'Assign a documentation owner.')
  assert.ok(Array.isArray(value.pages) && value.pages.every(page => /^[a-z0-9][a-z0-9-]{0,99}$/.test(page) && !page.includes('//')), 'Use flat stable documentation page IDs (lowercase kebab-case), independent of paths.')
  assert.equal(new Set(value.pages).size, value.pages.length, 'Duplicate documentation page IDs.')
  if (value.impact === 'required') assert.ok(value.pages.length, 'Required customer documentation needs affected page IDs.')
  else {
    assert.equal(value.pages.length, 0, 'No-impact changes cannot list affected pages.')
    assert.ok(typeof value.reason === 'string' && value.reason.trim().length >= 20, 'Explain why customer documentation is unaffected.')
  }
  return value
}
