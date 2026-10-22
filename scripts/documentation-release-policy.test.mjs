import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { validateDocumentationImpact } from './lib/documentation-release-policy.mjs'
import { requestDocumentationUpdate } from './request-documentation-update.mjs'

const sha = 'a'.repeat(40)
const notes = '# Existing canonical release notes\n'
const fixture = ({failDispatch = false, mismatch = false} = {}) => {
  let dispatches = 0
  return { get dispatches() {return dispatches}, execute(command, args, options) {
    assert.equal(command, 'gh')
    if (args.includes('POST')) { dispatches++; assert.equal(options.env.GH_TOKEN, 'private-dispatch-fixture'); if(failDispatch) throw Error('owned transport failure'); return '' }
    if (args[1].includes('/releases/') && !args[1].includes('/contents/')) return JSON.stringify({draft:false,prerelease:false,published_at:'2026-10-22',tag_name:'v0.33.0',body:mismatch?'different':notes})
    if (args[1].includes('/commits/')) return JSON.stringify({sha})
    return JSON.stringify({encoding:'base64',content:Buffer.from(notes).toString('base64')})
  } }
}
test('documentation impact requires an owner and explicit affected pages or a no-impact reason', () => {
  validateDocumentationImpact({impact:'required',owner:'identity-maintainers',pages:['configure-sso']})
  validateDocumentationImpact({impact:'none',owner:'release-maintainers',pages:[],reason:'No customer task or runtime contract changes.'})
  for(const value of [undefined,{impact:'required',owner:'unassigned',pages:['sso']},{impact:'required',owner:'owner',pages:[]},{impact:'none',owner:'owner',pages:[]}]) assert.throws(()=>validateDocumentationImpact(value))
})
test('handoff reuses canonical Markdown and sends an immutable identity without regenerating notes', async () => {
  const f=fixture();const result=await requestDocumentationUpdate({tag:'v0.33.0',execute:f.execute,env:{DOCUMENTATION_UPDATE_TOKEN:'private-dispatch-fixture'}})
  assert.equal(result.sourceCommit,sha);assert.equal(result.status,'handoff-accepted');assert.equal(f.dispatches,1)
})
test('mismatched notes or missing credentials stop only the independent handoff', async () => {
  const f=fixture({mismatch:true});await assert.rejects(requestDocumentationUpdate({execute:f.execute}),/canonical Markdown/);assert.equal(f.dispatches,0)
  await assert.rejects(requestDocumentationUpdate({execute:fixture().execute,env:{}}),/pending/)
})
test('transport retries are bounded and can recover without rerunning a software publisher', async () => {
  const f=fixture({failDispatch:true});await assert.rejects(requestDocumentationUpdate({execute:f.execute,env:{DOCUMENTATION_UPDATE_TOKEN:'private-dispatch-fixture'},wait:async()=>{}}),/three delivery attempts/);assert.equal(f.dispatches,3)
})
test('OSS authorization, recovery and aggregate jobs do not depend on customer documentation', () => {
  for(const name of ['release-please.yml','release-publication-reconcile.yml']) {
    const source=readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8')
    assert.ok(!source.includes('DOCUMENTATION_'));assert.ok(!source.includes('documentation_run_id'))
  }
  const approval=readFileSync(new URL('./release-publication-approval.mjs',import.meta.url),'utf8')
  assert.ok(!approval.includes('documentationEvidence'))
  const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')
  assert.ok(!ci.includes('documentation-release-handoff'))
})
