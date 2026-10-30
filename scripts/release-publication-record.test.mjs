import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPublicationRecord, assertSamePublication, validatePublicationRecord, identityHash, publicationRecoveryPlan } from './lib/release-publication-record.mjs'
import { observePublication, resumePublication } from './lib/release-publication-observation.mjs'
import { reconcileHistoricalReleaseLabels, reservedVersionCommitOverride, prepareReplacementMetadata } from './release-publication-labels.mjs'
import { createSecurityProof, SECURITY_ROLES, validateSecurityProof } from './lib/release-publication-security.mjs'
import { productionObservers } from './release-publication-observe.mjs'
import { createHash } from 'node:crypto'
import { verifyFailedIdentityArtifact, readIdentityArchive, verifyUnsignedIdentityManifest } from './release-publication-signature-recovery.mjs'

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

function identityRecoveryFixture() {
  const {candidate, authorization: old} = recordFixture()
  const authorization = {schemaVersion:1,...old,controlRef:candidate.sourceRevision,recoveryPRs:[],workflowRun:'123',publicationPerformed:false}
  const original = createPublicationRecord({authorization,candidate,candidateRef:`ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate@sha256:${'f'.repeat(64)}`})
  const security = {schemaVersion:'enterpriseglue-release-publication-security/v1',status:'passed',sourceRef:candidate.sourceRevision,
    scanner:'aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f',
    ignorePolicySha256:'e'.repeat(64),database:{UpdatedAt:new Date(Date.now()-1000).toISOString(),NextUpdate:new Date(Date.now()+86400000).toISOString()},
    reports:SECURITY_ROLES.flatMap(role=>['amd64','arm64'].map(arch=>({role,platform:`linux/${arch}`,subject:candidate.subjects[role].subject,sha256:'e'.repeat(64)})))}
  original.security=security
  const documents=Object.fromEntries(Object.entries({'authorization.json':authorization,'publication.json':original,'security/security.json':security})
    .map(([name,value])=>[name,JSON.stringify(value,null,2)+'\n']))
  const archive=Buffer.from('authenticated GitHub archive fixture')
  const run={id:123,status:'completed',conclusion:'failure',event:'workflow_dispatch',path:'.github/workflows/release-please.yml',head_branch:'main',
    head_sha:candidate.sourceRevision,head_repository:{full_name:'EnterpriseGlue/enterpriseglue-the-bridge-oss'},actor:{login:authorization.requestedBy}}
  const steps=[['Resolve release preparation or explicitly approved publication','success'],['Verify signed candidate before tag creation','success'],
    ['Refresh security evidence for the exact frozen images','success'],['Persist the signed publication identity before creating any tag','failure'],
    ['Run Release Please','skipped'],['Retain batch publication authorization','success']].map(([name,conclusion])=>({name,conclusion}))
  return {candidate,documents,archive,proposed:structuredClone(original),run,jobs:[{run_id:123,name:'release-please',head_sha:run.head_sha,conclusion:'failure',steps}],
    artifact:{name:'release-publication-authorization-123',expired:false,workflow_run:{id:123,head_sha:run.head_sha},size_in_bytes:archive.length,
      digest:`sha256:${createHash('sha256').update(archive).digest('hex')}`}}
}

test('original unsigned identity bytes require authenticated failed-run custody and a freshly approved identical publication',()=>{
  const f=identityRecoveryFixture()
  assert.deepEqual(verifyFailedIdentityArtifact(f),Buffer.from(f.documents['publication.json']))
})

for(const [name,mutate] of [
  ['wrong workflow',f=>{f.run.path='.github/workflows/other.yml'}],
  ['automatic event',f=>{f.run.event='push'}],
  ['unprotected branch',f=>{f.run.head_branch='feature'}],
  ['foreign job run',f=>{f.jobs[0].run_id=124}],
  ['fork',f=>{f.run.head_repository.full_name='outsider/repository'}],
  ['wrong source',f=>{f.run.head_sha='b'.repeat(40)}],
  ['incomplete run',f=>{f.run.status='in_progress'}],
  ['successful run',f=>{f.run.conclusion='success'}],
  ['duplicate jobs',f=>{f.jobs.push(f.jobs[0])}],
  ['missing security acceptance',f=>{f.jobs[0].steps[2].conclusion='failure'}],
  ['tag step ran',f=>{f.jobs[0].steps[4].conclusion='success'}],
  ['unretained authority',f=>{f.jobs[0].steps[5].conclusion='failure'}],
  ['foreign artifact',f=>{f.artifact.name='other'}],
  ['expired artifact',f=>{f.artifact.expired=true}],
  ['foreign artifact run',f=>{f.artifact.workflow_run.id=124}],
  ['size drift',f=>{f.artifact.size_in_bytes++}],
  ['archive digest drift',f=>{f.archive[0]^=1}],
  ['missing digest',f=>{delete f.artifact.digest}],
  ['expired fresh security',f=>{f.proposed.security.database.NextUpdate='2000-01-01T00:00:00Z'}],
  ['unknown original field',f=>{const r=JSON.parse(f.documents['publication.json']);r.authorized=true;f.documents['publication.json']=JSON.stringify(r)}],
  ['fabricated observation',f=>{const r=JSON.parse(f.documents['publication.json']);r.observations=[{name:'fake',status:'verified'}];f.documents['publication.json']=JSON.stringify(r)}],
  ['authority run drift',f=>{const a=JSON.parse(f.documents['authorization.json']);a.workflowRun='124';f.documents['authorization.json']=JSON.stringify(a)}],
  ['authority actor drift',f=>{const a=JSON.parse(f.documents['authorization.json']);a.requestedBy='foreign';f.documents['authorization.json']=JSON.stringify(a)}],
  ['retargeted candidate',f=>{f.proposed.identity.candidateRef=f.proposed.identity.candidateRef.replace(/f/g,'a');f.proposed.identityHash=identityHash(f.proposed.identity)}],
]) test(`unsigned identity recovery rejects ${name}`,()=>{
  const f=identityRecoveryFixture();mutate(f);assert.throws(()=>verifyFailedIdentityArtifact(f))
})

test('original custody ZIP reader accepts exact files and rejects duplicate, linked and escaping members',()=>{
  const f=identityRecoveryFixture()
  const zip=kind=>spawnSync('python3',['-c',`import io,sys,json,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for n,v in json.load(sys.stdin).items(): z.writestr(n,v)
 if sys.argv[1]=='duplicate': z.writestr('publication.json','{}')
 if sys.argv[1]=='escape': z.writestr('../escape','{}')
 if sys.argv[1]=='link':
  i=zipfile.ZipInfo('link');i.external_attr=0o120777<<16;z.writestr(i,'publication.json')
sys.stdout.buffer.write(b.getvalue())`,kind],{input:JSON.stringify(f.documents),maxBuffer:1024*1024}).stdout
  assert.deepEqual(readIdentityArchive(zip('valid')),f.documents)
  for(const kind of ['duplicate','escape','link'])assert.throws(()=>readIdentityArchive(zip(kind)))
})

test('production store repairs only exact authenticated bytes on a genuine missing-signature response and never retries uncertain signing',()=>{
  const directory=mkdtempSync(join(tmpdir(),'eg-identity-signature-'))
  try {
    const bin=join(directory,'bin');mkdirSync(bin)
    for(const command of ['bash','dirname','mktemp','rm','cat','grep','jq','cp','mv','mkdir','cmp']){
      const p=spawnSync('sh',['-c',`command -v ${command}`],{encoding:'utf8'});assert.equal(p.status,0);symlinkSync(p.stdout.trim(),join(bin,command))
    }
    symlinkSync(process.execPath,join(bin,'node'))
    writeFileSync(join(bin,'oras'),`#!/bin/bash
set -euo pipefail
if [[ "$1" == resolve ]]; then
 if [[ "$2" == *:attempt-* && ! -f "$FIXTURE_STATE/attempt" ]]; then
  printf 'Error response from registry: failed to resolve digest: %s: not found\\n' "$2" >&2;exit 1
 fi
 printf 'sha256:%064d\\n' 0
elif [[ "$1" == manifest ]]; then cat "$FIXTURE_STATE/manifest.json"
elif [[ "$1" == pull ]]; then cp "$FIXTURE_STATE/original.json" "$4/publication.json"
elif [[ "$1" == push ]]; then : > "$FIXTURE_STATE/attempt"
else exit 93
fi
`,{mode:0o755})
    writeFileSync(join(bin,'cosign'),`#!/bin/bash
set -euo pipefail
if [[ "$1" == verify && ! -f "$FIXTURE_STATE/signed" ]]; then printf '%s\\n' "$FIXTURE_ERROR" >&2;exit 10;fi
if [[ "$1" == sign ]]; then
 printf 'sign\\n' >> "$FIXTURE_STATE/sign-calls"
 : > "$FIXTURE_STATE/signed"
 [[ "$FIXTURE_SIGN_FAILURE" == false ]]
fi
`,{mode:0o755})
    const {record}=recordFixture();record.canary={fixture:true,publicationPerformed:false}
    const proposed=join(directory,'proposed.json'),original=join(directory,'original.json'),expected=join(directory,'expected.json')
    const bytes=JSON.stringify(record);writeFileSync(proposed,bytes);writeFileSync(original,bytes)
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(unsignedManifest(Buffer.from(bytes))))
    const run=({error='Error: no signatures found',expectedBytes=bytes,recovery=true,signFailure=false}={})=>{
      for(const file of ['attempt','signed','sign-calls'])rmSync(join(directory,file),{force:true})
      writeFileSync(expected,expectedBytes)
      const result=spawnSync('/bin/bash',['scripts/release-publication-record-store.sh','save',proposed,'pre-tag',...(recovery?[expected]:[])],{
        env:{PATH:bin,FIXTURE_STATE:directory,FIXTURE_ERROR:error,FIXTURE_SIGN_FAILURE:String(signFailure),GITHUB_SERVER_URL:'https://github.com',
          GITHUB_REPOSITORY:'EnterpriseGlue/enterpriseglue-the-bridge-oss',GITHUB_WORKFLOW:'Release Canary',GITHUB_REF:'refs/heads/fixture',
          GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',EG_PUBLICATION_CANARY:'true',EG_PUBLICATION_REPOSITORY:'ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication'},encoding:'utf8'})
      const calls=spawnSync('cat',[join(directory,'sign-calls')],{encoding:'utf8'})
      return {result,signs:calls.status===0?calls.stdout.trim().split('\n').length:0}
    }
    const ok=run();assert.equal(ok.result.status,0,ok.result.stderr);assert.equal(ok.signs,2)
    for(const options of [{recovery:false},{expectedBytes:bytes+'\n'},
      {error:'Error: no matching signatures: invalid certificate'},{error:'Error: registry transport timeout'},
      {error:'Error: invalid signature'},{error:'Error: unauthorized: no signatures found'}]){
      const rejected=run(options);assert.notEqual(rejected.result.status,0);assert.equal(rejected.signs,0)
    }
    const lost=run({signFailure:true});assert.notEqual(lost.result.status,0);assert.equal(lost.signs,1)
  }finally{rmSync(directory,{recursive:true,force:true})}
})

function unsignedManifest(bytes) {
  return {schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',artifactType:'application/vnd.enterpriseglue.release-publication.v1',
    config:{mediaType:'application/vnd.oci.empty.v1+json',digest:'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',size:2,data:'e30='},
    layers:[{mediaType:'application/vnd.enterpriseglue.release-publication.v1+json',digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,size:bytes.length,
      annotations:{'org.opencontainers.image.title':'publication.json'}}],annotations:{'org.opencontainers.image.created':'2026-10-30T15:52:10Z'}}
}

test('unsigned identity signing rejects extra OCI content, aliases and duplicate metadata before any layer download',()=>{
  const bytes=Buffer.from(identityRecoveryFixture().documents['publication.json'])
  const original=unsignedManifest(bytes)
  assert.doesNotThrow(()=>verifyUnsignedIdentityManifest(Buffer.from(JSON.stringify(original)),bytes))
  for(const mutate of [m=>{m.layers.push(m.layers[0])},m=>{m.layers[0].size++},m=>{m.layers[0].digest='sha256:'+'0'.repeat(64)},
    m=>{m.layers[0].annotations['org.opencontainers.image.title']='../publication.json'},m=>{m.layers[0].urls=['https://other.example/file']},
    m=>{m.config.data='untrusted'},m=>{m.subject={digest:'sha256:'+'1'.repeat(64)}},m=>{m.annotations.extra='untrusted'}]){
    const changed=structuredClone(original);mutate(changed)
    assert.throws(()=>verifyUnsignedIdentityManifest(Buffer.from(JSON.stringify(changed)),bytes))
  }
  assert.throws(()=>verifyUnsignedIdentityManifest(Buffer.from(JSON.stringify(original).replace('"schemaVersion":2','"schemaVersion":1,"schemaVersion":2')),bytes))
})

const ordinaryPull = () => ({number: 571, title: 'fix(release): make publication resumable', body: 'Reviewed code and validation.\n',
  head: {ref: 'fix/publication', repo: {full_name: 'EnterpriseGlue/enterpriseglue-the-bridge-oss'}}})

test('a reserved version uses the upstream commit override protocol, preserves the review and is idempotent', () => {
  const pull = ordinaryPull()
  const body = reservedVersionCommitOverride(pull, 'v0.30.0')
  assert.ok(body.startsWith(pull.body))
  // This is the extraction used by release-please 17.6 commit preprocessing.
  const commit = body.split('BEGIN_COMMIT_OVERRIDE')[1].split('END_COMMIT_OVERRIDE')[0].trim()
  assert.equal(commit, `${pull.title}\n\nRelease-As: 0.30.0`)
  assert.equal(reservedVersionCommitOverride({...pull, body}, 'v0.30.0'), body)
  const changed = reservedVersionCommitOverride({...pull, body}, 'v0.31.0')
  assert.ok(changed.startsWith(pull.body))
  assert.equal(changed.split('BEGIN_COMMIT_OVERRIDE').length, 2)
  assert.match(changed, /Release-As: 0\.31\.0/)
})

for (const [name, mutate] of [
  ['generated release PR', pull => {pull.head.ref = 'release-please--branches--main'}],
  ['human commit override', pull => {pull.body += '\nBEGIN_COMMIT_OVERRIDE\nfeat: reviewed human message\nEND_COMMIT_OVERRIDE'}],
  ['incomplete managed marker', pull => {pull.body += '\n<!-- enterpriseglue-reserved-release-version -->'}],
  ['oversized body', pull => {pull.body = 'x'.repeat(65536)}],
  ['multiline title', pull => {pull.title += '\nRelease-As: 99.0.0'}],
]) test(`reserved version metadata rejects ${name} without rewriting it`, () => {
  const pull = ordinaryPull()
  mutate(pull)
  const before = structuredClone(pull)
  assert.throws(() => reservedVersionCommitOverride(pull, 'v0.30.0'))
  assert.deepEqual(pull, before)
})

test('replacement metadata selects the reviewed source and removes only attached legacy states', () => {
  const pull = ordinaryPull()
  const reservation = {labels: [{name: 'autorelease: pending'}, {name: 'release:breaking'}]}
  const changes = []
  const options = {authorization: {prepareReplacement: true, sourceRef: 'a'.repeat(40), releaseTag: 'v0.30.0', releasePR: 567},
    repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', pages: [[
      {number: 571, merged_at: '2026-10-10T00:00:00Z', merge_commit_sha: 'a'.repeat(40), head: {ref: pull.head.ref}},
      {number: 572, merged_at: '2026-10-11T00:00:00Z', merge_commit_sha: 'b'.repeat(40), head: {ref: 'unrelated'}},
      {number: 567, merged_at: '2026-10-12T00:00:00Z', merge_commit_sha: 'a'.repeat(40), head: {ref: 'release-please--branches--main'}},
    ]], isAncestor: sha => sha === 'a'.repeat(40) ? 0 : 1,
    readPull: number => number === 571 ? pull : reservation,
    writeBody: (number, body) => {pull.body = body; changes.push({number, body})},
    addLabel: (number, label) => changes.push({number, add: label}),
    removeLabel: (number, label) => changes.push({number, remove: label}),
  }
  assert.deepEqual(prepareReplacementMetadata(options), {supersededReleasePR: 567, versionOverridePR: 571, publicationPerformed: false})
  assert.deepEqual(changes.filter(change => change.remove), [{number: 567, remove: 'autorelease: pending'}])
  reservation.labels = [{name: 'autorelease: superseded'}]
  const count = changes.filter(change => change.body).length
  prepareReplacementMetadata(options)
  assert.equal(changes.filter(change => change.body).length, count)
})

test('replacement version metadata cannot edit a foreign code PR', () => {
  const pull = ordinaryPull()
  pull.head.repo.full_name = 'external/fork'
  assert.throws(() => prepareReplacementMetadata({authorization: {prepareReplacement: true, sourceRef: 'a'.repeat(40), releaseTag: 'v0.30.0', releasePR: 567},
    repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', pages: [[{number: 571, merged_at: '2026-10-10', merge_commit_sha: 'a'.repeat(40), head: {ref: pull.head.ref}}]],
    isAncestor: () => 0, readPull: () => pull, writeBody: () => assert.fail('No write permitted'),
    addLabel: () => assert.fail('No label write permitted'), removeLabel: () => assert.fail('No label write permitted'),
  }), /first-party/)
})

for (const publisher of ['plugin-package-release.yml', 'host-package-release.yml', 'docker-images.yml',
  'host-chart-release.yml', 'plugin-toolchain-release.yml']) {
  test(`authorized ${publisher} recovery matches its real workflow inputs and publishes instead of defaulting to a dry run`, async () => {
    const {record} = recordFixture()
    const observed = await observePublication(record, adapters({workflow: name => ({status: name === publisher ? 'failed' : 'verified'})}))
    const requests = await resumePublication(observed, {explicitRecovery: true, dispatch: () => {}})
    assert.equal(requests.length, 1)
    assert.equal(requests[0].publisher, publisher)
    assert.equal(requests[0].inputs.source_ref, record.identity.sourceRef)
    assert.equal(requests[0].inputs.release_tag, record.identity.releaseTag)
    const workflow = readFileSync(new URL(`../.github/workflows/${publisher}`, import.meta.url), 'utf8')
    const declarations = [...workflow.matchAll(/^      ([a-z_]+):\s*$/gm)].map(match => match[1])
    for (const input of Object.keys(requests[0].inputs)) assert.ok(declarations.includes(input), `${publisher} rejects undeclared input ${input}`)
    if (declarations.includes('dry_run')) assert.equal(requests[0].inputs.dry_run, 'false')
  })
}

test('production OCI observation recognizes only a target-specific missing manifest and preserves unknown errors', async () => {
  const {record} = recordFixture()
  const target = record.identity.targets[0]
  let failure = `Error response from registry: failed to resolve digest: ${target.reference}: not found`
  const observers = productionObservers({record, artifacts: 'fixture', evidence: 'fixture',
    repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss',
    runCommand: () => {throw Object.assign(new Error('Fixture registry error'), {stderr: failure})},
  })
  assert.equal((await observers.oci(target)).status, 'missing')
  for (const error of ['unauthorized: authentication required', 'dial tcp: i/o timeout',
    'Error response from registry: failed to resolve digest: ghcr.io/other/image:tag: not found']) {
    failure = error
    await assert.rejects(observers.oci(target), /Fixture registry error/)
  }
  failure = `Error response from registry: failed to resolve digest: ghcr.io/enterpriseglue/releases/enterpriseglue-oss-distribution:${record.identity.releaseTag}: not found`
  assert.equal((await observers.distribution()).status, 'missing')
})

test('production signature observation matches exact protected producer identities and rejects different hosts, refs and workflows', async () => {
  const {record} = recordFixture()
  const target = record.identity.targets[0]
  const observers = productionObservers({record, artifacts: 'fixture', evidence: 'fixture',
    repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', runCommand: (binary, args) => {
      if (binary === 'oras') return target.expectedDigest
      assert.equal(binary, 'cosign')
      const pattern = new RegExp(args[args.indexOf('--certificate-identity-regexp') + 1])
      for (const workflow of ['docker-images-reusable', 'release-candidate-stage', 'host-chart-release', 'plugin-toolchain-release']) {
        assert.ok(pattern.test(`https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/${workflow}.yml@refs/heads/main`))
        assert.ok(pattern.test(`https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/${workflow}.yml@refs/tags/v0.30.0`))
      }
      for (const identity of [
        'https://githubXcom/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/release-candidate-stage.yml@refs/heads/main',
        'https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/release-candidate-stage.yml@refs/heads/feature',
        'https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/release-candidate-stage.yml@refs/tags/v0x30x0',
        'https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/untrusted.yml@refs/heads/main',
      ]) assert.equal(pattern.test(identity), false, identity)
      return 'verified fixture signature'
    },
  })
  assert.equal((await observers.oci(target)).status, 'verified')
})

test('record storage recognizes the real ORAS missing-manifest response without optional runner tools and stops on unknown registry errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eg-ledger-runner-'))
  try {
    // Reproduce the minimal hosted runner PATH instead of letting local rg mask
    // an undeclared dependency. Execute the production resolver, not a copy.
    for (const command of ['mktemp', 'rm', 'cat', 'grep']) {
      const resolved = spawnSync('sh', ['-c', `command -v ${command}`], {encoding: 'utf8'})
      assert.equal(resolved.status, 0)
      symlinkSync(resolved.stdout.trim(), join(directory, command))
    }
    writeFileSync(join(directory, 'oras'), '#!/bin/bash\nprintf "%s\\n" "$ORAS_ERROR" >&2\nexit 1\n', {mode: 0o755})
    const source = readFileSync(new URL('./release-publication-record-store.sh', import.meta.url), 'utf8')
    const resolver = source.slice(source.indexOf('resolve_existing() {'), source.indexOf('verify_subject() {'))
    const reference = `ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication:identity-sha-${'a'.repeat(40)}`
    const run = error => spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${resolver}\nresolve_existing "$REFERENCE"`], {
      env: {PATH: directory, REFERENCE: reference, ORAS_ERROR: error}, encoding: 'utf8',
    })
    const missing = run(`Error response from registry: failed to resolve digest: ${reference}: not found`)
    assert.equal(missing.status, 0, missing.stderr)
    assert.equal(missing.stdout, '')
    for (const error of ['unauthorized: authentication required', 'dial tcp: i/o timeout', 'proxy endpoint: not found',
      'Error response from registry: failed to resolve digest: ghcr.io/other/image:tag: not found']) {
      const unknown = run(error)
      assert.notEqual(unknown.status, 0, error)
      assert.equal(unknown.stdout, '')
      assert.match(unknown.stderr, /authentication|timeout|not found/)
    }
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})

test('the production record store configures OCI signing and verifies both immutable writes on a minimal runner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eg-ledger-storage-'))
  try {
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    for (const command of ['bash', 'dirname', 'mktemp', 'rm', 'cat', 'grep', 'jq', 'cp', 'mv', 'mkdir']) {
      const resolved = spawnSync('sh', ['-c', `command -v ${command}`], {encoding: 'utf8'})
      assert.equal(resolved.status, 0)
      symlinkSync(resolved.stdout.trim(), join(bin, command))
    }
    symlinkSync(process.execPath, join(bin, 'node'))
    writeFileSync(join(bin, 'oras'), `#!/bin/bash
set -euo pipefail
tag="\${2##*:}"
if [[ "$1" == resolve ]]; then
  if [[ -f "$FIXTURE_STATE/$tag" ]]; then
    printf 'sha256:%064d\\n' 0
  else
    printf 'Error response from registry: failed to resolve digest: %s: not found\\n' "$2" >&2
    exit 1
  fi
elif [[ "$1" == push ]]; then
  [[ "$2" == ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication:* ]]
  : > "$FIXTURE_STATE/$tag"
else
  exit 93
fi
`, {mode: 0o755})
    writeFileSync(join(bin, 'cosign'), `#!/bin/bash
set -euo pipefail
[[ "$COSIGN_EXPERIMENTAL" == 1 ]]
if [[ "$1" == sign ]]; then [[ "$*" == *--registry-referrers-mode=oci-1-1* ]]; fi
printf '%s\\n' "$1" >> "$FIXTURE_STATE/cosign-calls"
`, {mode: 0o755})
    const {record} = recordFixture()
    record.canary = {fixture: true, publicationPerformed: false}
    const file = join(directory, 'publication.json')
    writeFileSync(file, JSON.stringify(record))
    const result = spawnSync('/bin/bash', ['scripts/release-publication-record-store.sh', 'save', file, 'fixture'], {
      env: {PATH: bin, FIXTURE_STATE: directory, GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', GITHUB_WORKFLOW: 'Release Canary',
        GITHUB_REF: 'refs/heads/fixture', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1',
        EG_PUBLICATION_CANARY: 'true', EG_PUBLICATION_REPOSITORY: 'ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication'},
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(join(directory, 'cosign-calls'), 'utf8').trim().split('\n'), ['sign', 'verify', 'sign', 'verify'])
    assert.match(result.stdout, /enterpriseglue-release-canary-publication@sha256:/)
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})

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
    GITHUB_REPOSITORY_OWNER:'EnterpriseGlue',GITHUB_REPOSITORY:'EnterpriseGlue/enterpriseglue-the-bridge-oss',
    SOURCE_REF:control,REQUESTED_RELEASE_TAG:'',UPSTREAM_PATH:'.github/workflows/docker-images.yml',
    UPSTREAM_REPOSITORY:'EnterpriseGlue/enterpriseglue-the-bridge-oss',UPSTREAM_HEAD_REPOSITORY:'EnterpriseGlue/enterpriseglue-the-bridge-oss',
    UPSTREAM_CONCLUSION:'success',UPSTREAM_EVENT:'workflow_dispatch',UPSTREAM_SHA:control,UPSTREAM_TITLE:`Docker Images / v0.30.0 / ${source}`}
  const result=spawnSync('bash',['-c',script],{env,encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
  assert.equal(readFileSync(output,'utf8'),`SOURCE_REF=${source}\nREQUESTED_RELEASE_TAG=v0.30.0\n`)
  for (const title of [`Docker Images / / ${control}`,`Docker Images / sha-${control.slice(0,12)} / ${control}`,'Other Images / v0.30.0 / '+source]) {
    assert.notEqual(spawnSync('bash',['-c',script],{env:{...env,UPSTREAM_TITLE:title},encoding:'utf8'}).status,0)
  }
})

function imageHandoffAuthority(file) {
  const workflow=readFileSync(new URL(`../.github/workflows/${file}`,import.meta.url),'utf8')
  const start=workflow.indexOf('      - name: Validate protected release authority\n')
  assert.notEqual(start,-1)
  const end=workflow.indexOf('\n      - name:',start+1)
  const step=workflow.slice(start,end)
  for (const [name,field] of [['UPSTREAM_PATH','path'],['UPSTREAM_REPOSITORY','repository.full_name'],
    ['UPSTREAM_HEAD_REPOSITORY','head_repository.full_name'],['UPSTREAM_CONCLUSION','conclusion'],
    ['UPSTREAM_EVENT','event'],['UPSTREAM_SHA','head_sha']]) {
    assert.ok(step.includes(`${name}: \${{ github.event.workflow_run.${field} }}`),`${file}: ${name} must use actual upstream metadata`)
  }
  const marker='        run: |\n'
  const script=step.slice(step.indexOf(marker)+marker.length).split('\n')
    .filter(line=>line.startsWith('          ')||line==='').map(line=>line.slice(10)).join('\n')
  assert.ok(!script.includes('${{'),'Upstream metadata must enter through quoted environment values, not shell interpolation')
  assert.ok(!script.includes('$UPSTREAM_NAME'),'Display names must not grant or deny publication authority')
  return script
}

for (const file of ['host-chart-release.yml','plugin-toolchain-release.yml']) {
  test(`${file}: actual protected guard accepts release runs independent of decorated display names`,()=>{
    const script=imageHandoffAuthority(file),repository='EnterpriseGlue/enterpriseglue-the-bridge-oss',source='a'.repeat(40)
    const env={PATH:process.env.PATH,GITHUB_EVENT_NAME:'workflow_run',GITHUB_REF:'refs/heads/main',
      GITHUB_REPOSITORY_OWNER:'EnterpriseGlue',GITHUB_REPOSITORY:repository,SOURCE_REF:source,
      REQUESTED_RELEASE_TAG:'',UPSTREAM_PATH:'.github/workflows/docker-images.yml',UPSTREAM_REPOSITORY:repository,
      UPSTREAM_HEAD_REPOSITORY:repository,UPSTREAM_CONCLUSION:'success',UPSTREAM_EVENT:'release',UPSTREAM_SHA:source}
    for (const name of ['Docker Images',`Docker Images / v0.30.1 / ${source}`,'Untrusted display text is not authority']) {
      const result=spawnSync('bash',['-c',script],{env:{...env,UPSTREAM_NAME:name,UPSTREAM_TITLE:name},encoding:'utf8'})
      assert.equal(result.status,0,result.stderr)
    }
    const result=spawnSync('bash',['-c',script],{env:{...env,GITHUB_EVENT_NAME:'workflow_dispatch',REQUESTED_RELEASE_TAG:'v0.30.1'},encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
  })

  const invalid=[
    ['another repository owner',{GITHUB_REPOSITORY_OWNER:'example'}],
    ['another target repository',{GITHUB_REPOSITORY:'EnterpriseGlue/other'}],
    ['an unprotected branch',{GITHUB_REF:'refs/heads/topic'}],
    ['a tag context',{GITHUB_REF:'refs/tags/v0.30.1'}],
    ['another root event',{GITHUB_EVENT_NAME:'pull_request'}],
    ['a mutable source',{SOURCE_REF:'main'}],
    ['a different upstream workflow',{UPSTREAM_PATH:'.github/workflows/ci.yml'}],
    ['missing workflow identity',{UPSTREAM_PATH:''}],
    ['a different upstream repository',{UPSTREAM_REPOSITORY:'example/other'}],
    ['a fork head repository',{UPSTREAM_HEAD_REPOSITORY:'example/fork'}],
    ['a failed image publication',{UPSTREAM_CONCLUSION:'failure'}],
    ['a pull-request image run',{UPSTREAM_EVENT:'pull_request'}],
    ['source drift',{UPSTREAM_SHA:'b'.repeat(40)}],
    ['manual recovery without a semantic tag',{GITHUB_EVENT_NAME:'workflow_dispatch',REQUESTED_RELEASE_TAG:'latest'}],
  ]
  for (const [name,change] of invalid) test(`${file}: actual protected guard rejects ${name}`,()=>{
    const script=imageHandoffAuthority(file),repository='EnterpriseGlue/enterpriseglue-the-bridge-oss',source='a'.repeat(40)
    const env={PATH:process.env.PATH,GITHUB_EVENT_NAME:'workflow_run',GITHUB_REF:'refs/heads/main',
      GITHUB_REPOSITORY_OWNER:'EnterpriseGlue',GITHUB_REPOSITORY:repository,SOURCE_REF:source,
      REQUESTED_RELEASE_TAG:'',UPSTREAM_PATH:'.github/workflows/docker-images.yml',UPSTREAM_REPOSITORY:repository,
      UPSTREAM_HEAD_REPOSITORY:repository,UPSTREAM_CONCLUSION:'success',UPSTREAM_EVENT:'release',UPSTREAM_SHA:source,
      UPSTREAM_NAME:'Docker Images',UPSTREAM_TITLE:`Docker Images / v0.30.1 / ${source}`,...change}
    assert.notEqual(spawnSync('bash',['-c',script],{env,encoding:'utf8'}).status,0)
  })
}

test('publication observation configures exact authenticated GitHub Packages access',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/release-please.yml',import.meta.url),'utf8')
  const start=workflow.indexOf('      - name: Setup Node\n'),end=workflow.indexOf('\n      - name:',start+1)
  const step=workflow.slice(start,end)
  assert.match(step,/registry-url: https:\/\/npm\.pkg\.github\.com/)
  assert.match(step,/scope: '@enterpriseglue'/)
  const observation=workflow.slice(workflow.indexOf('      - name: Observe actual publication progress and retain the signed attempt\n'))
  assert.ok(observation.includes('NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'))
})

test('publication retention selects all authority/security evidence without traversing scanner caches',()=>{
  const prefix='.artifacts/release-publication/'
  const expected=['authorization.json','publication.json','observation.json','replacement.json','recovery.json',
    'identity/publication.json','security/security.json','security/vulnerability-database.json',
    ...SECURITY_ROLES.flatMap(role=>['amd64','arm64'].map(architecture=>`security/${role}-${architecture}.json`)),
    'observation-evidence'].map(path=>prefix+path)
  for (const [file,name] of [['release-please.yml','Retain batch publication authorization'],
    ['release-publication-reconcile.yml','Retain non-secret diagnostics']]) {
    const workflow=readFileSync(new URL(`../.github/workflows/${file}`,import.meta.url),'utf8')
    const step=workflow.slice(workflow.indexOf(`      - name: ${name}\n`))
    const block=step.match(/          path: \|\n((?:            [^\n]+\n)+)/)
    assert.ok(block,`${file}: evidence must use an explicit path inventory`)
    const paths=block[1].trim().split('\n').map(line=>line.trim())
    const required=[...expected]
    if(file==='release-please.yml')required.splice(required.indexOf(prefix+'identity/publication.json')+1,0,prefix+'identity-recovery/publication.json')
    assert.deepEqual(paths,required)
    assert.ok(!paths.some(path=>path.includes('cache')||path.includes('*')||path===prefix.slice(0,-1)||path===prefix+'security'))
    assert.match(step,/if-no-files-found: error/)
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
