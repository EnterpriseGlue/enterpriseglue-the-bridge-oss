import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPublicationRecord, assertSamePublication, validatePublicationRecord, identityHash, publicationRecoveryPlan } from './lib/release-publication-record.mjs'
import { observePublication, resumePublication } from './lib/release-publication-observation.mjs'
import { reconcileHistoricalReleaseLabels } from './release-publication-labels.mjs'
import { createSecurityProof, SECURITY_ROLES, validateSecurityProof } from './lib/release-publication-security.mjs'

export function recordFixture() {
  const source = 'a'.repeat(40)
  const subject = name => ({ subject: `ghcr.io/enterpriseglue/${name}@sha256:${'b'.repeat(64)}` })
  const candidate = { status: 'qualified', sourceRevision: source, releaseTag: 'v0.30.0',
    subjects: Object.fromEntries(['backend', 'frontend', 'managedShardBootstrap', 'pluginInstaller', 'pluginManager', 'hostChart', 'runtimeChart', 'installerRbacChart', 'managerChart'].map(name => [name, subject(name.toLowerCase())])),
    artifacts: [
      ...['enterpriseglue-host', 'enterpriseglue-plugin-runtime', 'enterpriseglue-plugin-installer-rbac', 'enterpriseglue-plugin-manager'].map(name => ({path: `charts/${name}-0.2.10.tgz`, sha256: 'c'.repeat(64), size: 1})),
      ...['shared', 'backend-host', 'frontend-host'].map(name => ({path: `packages/host/enterpriseglue-${name}-0.1.0.tgz`, sha256: 'c'.repeat(64), size: 1})),
      ...['enterprise-plugin-api', 'plugin-sdk', 'plugin-runtime', 'plugin-installer', 'plugin-manager'].map(name => ({path: `packages/plugin/enterpriseglue-${name}-0.1.0.tgz`, sha256: 'c'.repeat(64), size: 1})),
    ] }
  const authorization = { sourceRef: source, releaseTag: candidate.releaseTag, releasePR: 900, requiredPRs: [552, 551], previousTag: 'v0.29.3',
    documentation: {path: 'docs/releases/v0.30.0.md', sha256: 'd'.repeat(64), changelogSha256: 'e'.repeat(64)},
    controlRef: 'f'.repeat(40), recoveryPRs: [901], requestedBy: 'fixture-only', workflowRun: '1' }
  const record = createPublicationRecord({authorization, candidate, candidateRef: `ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate@sha256:${'f'.repeat(64)}`})
  return { record, candidate, authorization }
}

const passing = () => ({status: 'verified'})
const adapters = changes => ({ release: passing, oci: passing, package: passing, distribution: passing, workflow: passing, ...changes })

test('a frozen record binds exact packages, charts, documentation, batch and registry destinations', () => {
  const {record} = recordFixture()
  assert.deepEqual(record.identity.requiredPRs, [551, 552])
  assert.equal(record.identity.targets.filter(target => target.kind === 'package').length, 8)
  assert.equal(record.identity.targets.filter(target => target.mutable).length, 2)
  assert.equal(record.state, 'approved')
  assert.equal(record.identity.dockerhub.required, false)
  assertSamePublication(record, {...record, authorization: {...record.authorization, workflowRun: '2'}})
})

for (const [name, mutate] of [
  ['candidate', r => {r.identity.candidateRef = r.identity.candidateRef.replace(/f/g, 'a')}],
  ['documentation', r => {r.identity.documentation.sha256 = 'a'.repeat(64)}],
  ['batch', r => {r.identity.requiredPRs.push(553)}],
  ['artifact', r => {r.identity.artifacts[0].sha256 = 'a'.repeat(64)}],
  ['destination', r => {r.identity.targets.pop()}],
]) test(`a retry rejects a changed ${name}`, () => {
  const {record} = recordFixture()
  const changed = structuredClone(record)
  mutate(changed)
  changed.identityHash = identityHash(changed.identity)
  assert.throws(() => assertSamePublication(record, changed), /retry cannot change/)
})

test('published requires every actual destination and publisher to verify', async () => {
  const {record} = recordFixture()
  const complete = await observePublication(record, adapters())
  assert.equal(complete.state, 'published')
  assert.doesNotThrow(() => validatePublicationRecord(complete))
  complete.observations.pop()
  assert.throws(() => validatePublicationRecord(complete), /cover every destination/)
})

test('partial publication resumes only the missing publisher and becomes a no-op after success', async () => {
  const {record} = recordFixture()
  const partial = await observePublication(record, adapters({package: target => ({status: target.name === '@enterpriseglue/shared' ? 'missing' : 'verified'})}))
  assert.equal(partial.state, 'partially-published')
  const calls = []
  const requested = await resumePublication(partial, {explicitRecovery: true, dispatch: (publisher, inputs) => calls.push({publisher, inputs})})
  assert.deepEqual(requested.map(({publisher}) => publisher), ['host-package-release.yml'])
  assert.equal(calls[0].inputs.source_ref, record.identity.sourceRef)
  assert.equal(calls[0].inputs.release_tag, 'v0.30.0')
  const completed = await observePublication(partial, adapters())
  assert.deepEqual(await resumePublication(completed, {explicitRecovery: true, dispatch: () => assert.fail('Already verified publishers must not rerun.')}), [])
})

test('failed publisher acceptance prevents a green registry from establishing full publication', async () => {
  const {record} = recordFixture()
  const observed = await observePublication(record, adapters({workflow: publisher => ({status: publisher === 'plugin-toolchain-release.yml' ? 'failed' : 'verified'})}))
  assert.equal(observed.state, 'partially-published')
  assert.deepEqual(publicationRecoveryPlan(observed), ['plugin-toolchain-release.yml'])
})

for (const status of ['conflict', 'unknown']) test(`${status} prevents recovery writes`, async () => {
  const {record} = recordFixture()
  const observed = await observePublication(record, adapters({oci: () => ({status})}))
  await assert.rejects(() => resumePublication(observed, {explicitRecovery: true, dispatch: () => assert.fail('Must stop before dispatch.')}))
})

test('pending work is observed without redispatch, and image recovery waits to trigger toolchain', async () => {
  const {record} = recordFixture()
  const observed = await observePublication(record, adapters({oci: () => ({status: 'missing'}), workflow: publisher => ({status: publisher === 'host-chart-release.yml' ? 'pending' : 'verified'})}))
  const calls = await resumePublication(observed, {explicitRecovery: true, dispatch: () => {}})
  assert.deepEqual(calls.map(({publisher}) => publisher), ['docker-images.yml'])
})

test('automatic observations cannot authorize publication or recovery', async () => {
  const {record} = recordFixture()
  const observed = await observePublication(record, adapters({oci: () => ({status: 'missing'})}))
  await assert.rejects(() => resumePublication(observed, {dispatch: () => assert.fail('Automatic writes are forbidden.')}), /explicitly authorized/)
})

test('historical label reconciliation preserves the current release and rejects other active releases', () => {
  const {authorization} = recordFixture()
  const old = {number: 1, merged_at: '2026-01-01', merge_commit_sha: 'b'.repeat(40), head: {ref: 'release-please--branches--main'}, labels: [{name: 'autorelease: pending'}]}
  const removed = []
  reconcileHistoricalReleaseLabels({authorization, repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', pages: [[old, {...old,number:900}]],
    isAncestor: () => 0, remove: (number, label) => removed.push({number,label})})
  assert.deepEqual(removed, [{number:1,label:'autorelease: pending'}])
  assert.throws(() => reconcileHistoricalReleaseLabels({authorization, repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', pages: [[old]],
    isAncestor: () => 1, remove: () => assert.fail('Must not remove active-release labels.')}), /active unpublished/)
})

function securityFixture() {
  const {candidate} = recordFixture()
  const now = new Date('2026-10-10T00:00:00Z')
  const database = {UpdatedAt:'2026-10-09T22:00:00Z',NextUpdate:'2026-10-10T10:00:00Z'}
  const reports = Object.fromEntries(SECURITY_ROLES.flatMap(role => ['amd64','arm64'].map(architecture => [`${role}-${architecture}`,
    JSON.stringify({ArtifactName:candidate.subjects[role].subject,Metadata:{ImageConfig:{architecture,os:'linux'}},Results:[]})])))
  return {candidate,now,database,reports,ignorePolicy:Buffer.from('# maintained policy\n')}
}

test('fresh security proof binds all five candidate images, both architectures, scanner, policy and report hashes', () => {
  const fixture = securityFixture()
  const proof = createSecurityProof(fixture)
  assert.equal(proof.reports.length,10)
  assert.doesNotThrow(()=>validateSecurityProof(proof,fixture.candidate,{now:fixture.now}))
})

for (const [name, mutate] of [
  ['stale database', f=>{f.database.NextUpdate='2026-10-09T23:00:00Z'}],
  ['missing architecture', f=>{delete f.reports['backend-arm64']}],
  ['different image', f=>{const r=JSON.parse(f.reports['backend-arm64']);r.ArtifactName='ghcr.io/enterpriseglue/other@sha256:'+ 'c'.repeat(64);f.reports['backend-arm64']=JSON.stringify(r)}],
  ['wrong architecture', f=>{const r=JSON.parse(f.reports['backend-arm64']);r.Metadata.ImageConfig.architecture='amd64';f.reports['backend-arm64']=JSON.stringify(r)}],
  ['unignored vulnerability', f=>{const r=JSON.parse(f.reports['backend-arm64']);r.Results=[{Vulnerabilities:[{Severity:'HIGH'}]}];f.reports['backend-arm64']=JSON.stringify(r)}],
]) test(`security proof rejects ${name}`,()=>{
  const f=securityFixture();mutate(f);assert.throws(()=>createSecurityProof(f))
})

test('the actual toolchain authority step preserves the frozen source after manual image promotion', t => {
  const workflow=readFileSync(new URL('../.github/workflows/plugin-toolchain-release.yml',import.meta.url),'utf8')
  const start=workflow.indexOf('      - name: Validate protected release authority\n')
  const end=workflow.indexOf('\n      - name:',start+1)
  const step=workflow.slice(start,end)
  const script=step.slice(step.indexOf('        run: |\n')+'        run: |\n'.length).split('\n')
    .filter(line=>line.startsWith('          ')||line==='').map(line=>line.slice(10)).join('\n')
  const directory=mkdtempSync(join(tmpdir(),'eg-toolchain-authority-'))
  t.after(()=>rmSync(directory,{recursive:true,force:true}))
  const source='a'.repeat(40)
  const control='b'.repeat(40)
  const output=join(directory,'environment')
  const env={PATH:process.env.PATH,GITHUB_ENV:output,GITHUB_EVENT_NAME:'workflow_run',GITHUB_REF:'refs/heads/main',
    GITHUB_REPOSITORY_OWNER:'EnterpriseGlue',SOURCE_REF:control,REQUESTED_RELEASE_TAG:'',UPSTREAM_NAME:'Docker Images',
    UPSTREAM_CONCLUSION:'success',UPSTREAM_EVENT:'workflow_dispatch',UPSTREAM_SHA:control,UPSTREAM_TITLE:`Docker Images / v0.30.0 / ${source}`}
  const result=spawnSync('bash',['-c',script],{env,encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
  assert.equal(readFileSync(output,'utf8'),`SOURCE_REF=${source}\nREQUESTED_RELEASE_TAG=v0.30.0\n`)
  for (const title of [`Docker Images / / ${control}`,`Docker Images / sha-${control.slice(0,12)} / ${control}`,'Other Images / v0.30.0 / '+source]) {
    assert.notEqual(spawnSync('bash',['-c',script],{env:{...env,UPSTREAM_TITLE:title},encoding:'utf8'}).status,0)
  }
})

test('the actual privileged candidate validator accepts reserved metadata-only replacements and rejects content or tag drift', async () => {
  const workflow=readFileSync(new URL('../.github/workflows/release-candidate-stage.yml',import.meta.url),'utf8')
  const start=workflow.indexOf('      - name: Verify release-only merge delta and identity without checkout\n')
  const end=workflow.indexOf('\n  qualify-database-adapters:',start)
  const step=workflow.slice(start,end)
  const script=step.slice(step.indexOf('          script: |\n')+'          script: |\n'.length).split('\n')
    .filter(line=>line.startsWith('            ')||line==='').map(line=>line.slice(12)).join('\n')
  const source='a'.repeat(40), base='b'.repeat(40)
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
  const execute=async ({reserved=true,extra=false,tagged=false,baseVersion='0.30.0'}={})=>{
    const failures=[]
    const chart='apiVersion: v2\nname: enterpriseglue-host\nversion: 0.2.10\nappVersion: "0.29.3"\n'
    const content=(path,ref)=>path==='.github/.release-please-manifest.json' ? JSON.stringify({'.':ref===base ? baseVersion:'0.30.0'})
      : path==='CHANGELOG.md' ? '# Changelog\n\n## [0.30.0]\n'
      : path.startsWith('docs/') ? '# EnterpriseGlue v0.30.0 Release Notes\n'
      : ref===base ? chart:chart.replace('version: 0.2.10','version: 0.2.11').replace('appVersion: "0.29.3"','appVersion: "0.30.0"')
    const files=['CHANGELOG.md','docs/releases/v0.30.0.md','infra/kubernetes/helm/enterpriseglue-host/Chart.yaml',
      ...(!reserved ? ['.github/.release-please-manifest.json']:[]),...(extra ? ['packages/shared/package.json']:[])]
    const repos={getCommit:async()=>({data:{sha:source,parents:[{sha:base}]}}),
      compareCommitsWithBasehead:async()=>({data:{merge_base_commit:{sha:base},files:files.map(filename=>({filename}))}}),
      getContent:async({path,ref})=>({data:{type:'file',encoding:'base64',content:Buffer.from(content(path,ref)).toString('base64')}})}
    const git={getRef:async()=>{if(!tagged)throw Object.assign(new Error('Fixture missing tag'),{status:404});return {data:{object:{sha:'c'.repeat(40)}}}}}
    const github={rest:{repos,git}}
    await new AsyncFunction('github','context','core','process',script)(github,{repo:{owner:'EnterpriseGlue',repo:'enterpriseglue-the-bridge-oss'}},
      {setFailed:message=>failures.push(message)},{env:{SOURCE_REF:source,BASE_REF:base,RELEASE_TAG:'v0.30.0'}})
    return failures
  }
  assert.deepEqual(await execute(),[])
  assert.deepEqual(await execute({reserved:false,baseVersion:'0.29.3'}),[])
  assert.ok((await execute({extra:true}))[0].includes('exact generated'))
  assert.ok((await execute({tagged:true}))[0].includes('tagged version'))
  assert.ok((await execute({baseVersion:'0.29.3'}))[0].includes('unchanged manifest'))
})
