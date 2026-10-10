#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicationRecord, identityHash } from './lib/release-publication-record.mjs'

assert.equal(process.env.GITHUB_WORKFLOW, 'Release Canary')
assert.equal(process.env.EG_PUBLICATION_CANARY, 'true')
assert.equal(process.env.EG_PUBLICATION_REPOSITORY, 'ghcr.io/enterpriseglue/enterpriseglue-release-canary-publication')
const source = process.env.GITHUB_SHA
assert.match(source, /^[a-f0-9]{40}$/)
const candidate = {status:'qualified',sourceRevision:source,releaseTag:'v0.0.0',
  subjects:Object.fromEntries(['backend','frontend','managedShardBootstrap','pluginInstaller','pluginManager','hostChart','runtimeChart','installerRbacChart','managerChart']
    .map(role=>[role,{subject:role==='frontend' ? process.env.SCRATCH_FRONTEND_SUBJECT : process.env.SCRATCH_BACKEND_SUBJECT}])),
  artifacts:[
    ...['enterpriseglue-host','enterpriseglue-plugin-runtime','enterpriseglue-plugin-installer-rbac','enterpriseglue-plugin-manager'].map(name=>({path:`charts/${name}-0.0.0.tgz`,sha256:'0'.repeat(64),size:1})),
    ...['shared','backend-host','frontend-host'].map(name=>({path:`packages/host/enterpriseglue-${name}-0.0.0.tgz`,sha256:'0'.repeat(64),size:1})),
    ...['enterprise-plugin-api','plugin-sdk','plugin-runtime','plugin-installer','plugin-manager'].map(name=>({path:`packages/plugin/enterpriseglue-${name}-0.0.0.tgz`,sha256:'0'.repeat(64),size:1})),
  ]}
const record=createPublicationRecord({candidate,candidateRef:`ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate@sha256:${'0'.repeat(64)}`,
  authorization:{sourceRef:source,releaseTag:'v0.0.0',releasePR:1,requiredPRs:[2],previousTag:'v0.0.0',
    documentation:{path:'docs/releases/v0.0.0.md',sha256:'0'.repeat(64),changelogSha256:'0'.repeat(64)},
    controlRef:source,recoveryPRs:[],requestedBy:'fixture-only',workflowRun:process.env.GITHUB_RUN_ID}})
record.canary={fixture:true,signedCandidateAccepted:false,publicationPerformed:false}
const directory='.artifacts/release-publication-ledger-canary'
mkdirSync(directory,{recursive:true})
const file=join(directory,'publication.json')
writeFileSync(file,JSON.stringify(record,null,2)+'\n')
const save=phase=>execFileSync('bash',['scripts/release-publication-record-store.sh','save',file,phase],{encoding:'utf8',timeout:180000})
const first=save('first').trim()
assert.equal(save('first').trim(),first,'An identical attempt must reuse the same immutable digest.')
const repository=process.env.EG_PUBLICATION_REPOSITORY
const before=execFileSync('oras',['resolve',`${repository}:identity-sha-${source}`],{encoding:'utf8'}).trim()
const changed=structuredClone(record)
changed.identity.documentation.sha256='1'.repeat(64)
changed.identityHash=identityHash(changed.identity)
writeFileSync(file,JSON.stringify(changed,null,2)+'\n')
const rejected=spawnSync('bash',['scripts/release-publication-record-store.sh','save',file,'conflict'],{encoding:'utf8',timeout:180000})
assert.equal(rejected.status,1,'A changed immutable identity must be rejected.')
assert.match(rejected.stderr,/retry cannot change/)
assert.equal(execFileSync('oras',['resolve',`${repository}:identity-sha-${source}`],{encoding:'utf8'}).trim(),before,'Conflict handling must not overwrite the identity.')
writeFileSync(file,JSON.stringify(record,null,2)+'\n')
const loaded=join(directory,'repulled')
execFileSync('bash',['scripts/release-publication-record-store.sh','load',source,loaded],{encoding:'utf8',timeout:180000})
assert.equal(JSON.parse(readFileSync(join(loaded,'publication.json'),'utf8')).identityHash,record.identityHash)
writeFileSync(join(directory,'receipt.json'),JSON.stringify({kind:'release-publication-ledger-canary',sourceRevision:source,
  signedScratchRecord:first,immutableIdentity:`${repository}@${before}`,fixtureApi:true,signedCandidateAccepted:false,
  duplicateAttemptReused:true,identityConflictRejected:true,immutableRepullVerified:true,publicationPerformed:false,
  productionTagsWritten:false,productionAliasesChanged:false,packagePublicationPerformed:false},null,2)+'\n')
console.log('[release-publication-ledger-canary] signed scratch identity, duplicate reuse, conflict rejection and repull passed; production publication=false.')
