#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPublicationRecord, assertSamePublication, validatePublicationRecord } from './lib/release-publication-record.mjs'
import { verifyReceipt } from './release-candidate-receipt.mjs'
import { validateSecurityProof } from './lib/release-publication-security.mjs'

export async function main(argv = process.argv.slice(2)) {
  const [command, ...values] = argv
  const args = {}
  assert.equal(values.length % 2, 0)
  for (let i = 0; i < values.length; i += 2) {
    assert.match(values[i], /^--[a-z-]+$/)
    assert.ok(!Object.hasOwn(args, values[i].slice(2)), 'Duplicate argument.')
    args[values[i].slice(2)] = values[i + 1]
  }
  const json = name => JSON.parse(readFileSync(args[name], 'utf8'))
  if (command === 'create') {
    const authorization = json('authorization')
    const candidate = await verifyReceipt({ receipt: `${args.artifacts}/release-candidate.json`, artifacts: args.artifacts,
      'source-ref': authorization.sourceRef, 'release-tag': authorization.releaseTag })
    const record = createPublicationRecord({ authorization, candidate, candidateRef: args['candidate-ref'],
      dockerhubNamespace: args['dockerhub-namespace'] || '' })
    record.security = validateSecurityProof(json('security'), candidate)
    writeFileSync(args.output, `${JSON.stringify(record, null, 2)}\n`)
  } else if (command === 'verify') validatePublicationRecord(json('record'))
  else if (command === 'compare') assertSamePublication(json('existing'), json('proposed'))
  else throw new Error('Usage: release-publication-record.mjs create|verify|compare [--option value]')
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch(error => { console.error(`[release-publication-record] ${error.message}`); process.exitCode = 1 })
}
