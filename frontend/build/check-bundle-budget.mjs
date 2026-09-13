#!/usr/bin/env node

import { resolve } from 'node:path'
import { checkBuiltPublicLoginSignupBundle } from './bundle-budget.mjs'

const distDirectory = resolve(process.cwd(), process.argv[2] ?? 'dist')
const measurement = await checkBuiltPublicLoginSignupBundle({
  distDirectory,
  removeManifest: true,
})

process.stdout.write(`${JSON.stringify({
  surface: 'public-login-signup',
  ...measurement,
}, null, 2)}\n`)
