import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createRequire } from 'node:module'

const root = new URL('../', import.meta.url)

const parseVersion = (version) => {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/)
  assert.ok(match, `expected a stable semantic version, received ${version}`)
  return match.slice(1).map(Number)
}

const isAtLeast = (version, minimum) => {
  const actual = parseVersion(version)
  return actual.some((part, index) => (
    part > minimum[index] && actual.slice(0, index).every((value, prior) => value === minimum[prior])
  )) || actual.every((part, index) => part === minimum[index])
}

const isPatchedFastUri = (version) => {
  const [major, minor, patch] = parseVersion(version)
  const minimumByMajor = new Map([
    [2, [2, 4, 8]],
    [3, [3, 1, 9]],
    [4, [4, 2, 3]],
  ])
  const minimum = minimumByMajor.get(major)
  if (!minimum) return major > 4
  return isAtLeast(`${major}.${minor}.${patch}`, minimum)
}

test('request logging stays patched and vulnerable archive reader cannot return', async () => {
  const lockText = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  const versions = [...lockText.matchAll(/^ {2}morgan@(\d+\.\d+\.\d+):$/gm)].map(match => match[1])
  assert.ok(versions.length > 0, 'expected the request logger in the lockfile')
  for (const version of versions) assert.ok(isAtLeast(version, [1, 12, 1]), `morgan ${version} is below the security floor`)
  assert.doesNotMatch(lockText, /adm-zip/, 'vulnerable ZIP dependency must not return, including transitively')
  for (const name of ['backend', 'packages/shared', 'packages/backend-host']) {
    const manifest = JSON.parse(await readFile(new URL(`${name}/package.json`, root), 'utf8'))
    assert.equal(manifest.dependencies?.['adm-zip'], undefined)
  }
})

test('fast-uri security override and lockfile stay on a patched release line', async () => {
  const [packageText, workspaceText, lockText] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('pnpm-workspace.yaml', root), 'utf8'),
    readFile(new URL('pnpm-lock.yaml', root), 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.equal(packageJson.overrides, undefined, 'pnpm-workspace.yaml owns effective security overrides')
  assert.match(workspaceText, /^overrides:\n(?: {2}.+\n)* {2}fast-uri: \^3\.1\.9$/m)
  assert.match(workspaceText, /^overrides:\n(?: {2}.+\n)* {2}qs: \^6\.16\.0$/m)

  const lockedVersions = [...lockText.matchAll(/^ {2}fast-uri@(\d+\.\d+\.\d+):$/gm)]
    .map((match) => match[1])

  assert.ok(lockedVersions.length > 0, 'expected fast-uri to be represented in the lockfile')
  for (const version of lockedVersions) {
    assert.ok(isPatchedFastUri(version), `fast-uri ${version} is below its patched release floor`)
  }

  const lockedQsVersions = [...lockText.matchAll(/^ {2}qs@(\d+\.\d+\.\d+):$/gm)]
    .map((match) => match[1])
  assert.ok(lockedQsVersions.length > 0, 'expected qs to be represented in the lockfile')
  for (const version of lockedQsVersions) {
    assert.ok(isAtLeast(version, [6, 16, 0]), `qs ${version} is below 6.16.0`)
  }
})

test('approved mail/Git upgrades and compatible runtime dependencies cannot regress below reviewed security floors', async () => {
  const lockText = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  const floors = {
    '@grpc/grpc-js': [1, 14, 5],
    '@azure/msal-node': [7, 1, 0],
    'body-parser': [2, 4, 0],
    dompurify: [3, 4, 17],
    vite: [7, 3, 7],
    vitest: [4, 1, 12],
    '@vitest/mocker': [4, 1, 12],
    zod: [4, 6, 6],
    '@simple-git/argv-parser': [2, 0, 1],
    'ip-address': [10, 7, 4],
    nodemailer: [10, 1, 4],
    'proxy-addr': [2, 0, 8],
    'simple-git': [4, 0, 2],
    'source-map-js': [1, 2, 2],
    undici: [7, 30, 1],
  }
  for (const [name, minimum] of Object.entries(floors)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const versions = [...lockText.matchAll(new RegExp("^ {2}'?" + escaped + '@(\\d+\\.\\d+\\.\\d+)', 'gm'))].map(match => match[1])
    assert.ok(versions.length > 0, 'missing locked ' + name)
    for (const version of versions) assert.ok(isAtLeast(version, minimum), name + ' ' + version + ' regressed')
  }
  for (const version of [...lockText.matchAll(/^ {2}brace-expansion@(\d+\.\d+\.\d+):$/gm)].map(match => match[1])) {
    const [major] = parseVersion(version)
    assert.ok(isAtLeast(version, major === 2 ? [2, 1, 7] : [5, 0, 12]), 'brace-expansion ' + version + ' regressed')
  }
})

test('Nodemailer uses the real major-version transport and envelope API without network delivery', async () => {
  const requireShared = createRequire(new URL('packages/shared/package.json', root))
  const nodemailer = requireShared('nodemailer')
  const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'})
  try {
    const result = await transport.sendMail({
      from: 'EnterpriseGlue <sender@example.invalid>', to: 'recipient@example.invalid',
      subject: 'Upgrade compatibility', text: 'Local transport only',
    })
    assert.equal(typeof result.messageId, 'string')
    assert.deepEqual(result.envelope.to, ['recipient@example.invalid'])
    assert.ok(Buffer.isBuffer(result.message))
    assert.match(result.message.toString('utf8'), /Subject: Upgrade compatibility/)
    assert.match(result.message.toString('utf8'), /Local transport only/)
  } finally {
    transport.close()
  }
})

test('simple-git exposes the supported named factory and real read-only version command', async () => {
  const requireRoot = createRequire(new URL('package.json', root))
  const { simpleGit } = requireRoot('simple-git')
  assert.equal(typeof simpleGit, 'function')
  const result = await simpleGit().version()
  assert.ok(Number.isInteger(result.major) && result.major >= 2)
})

test('production dependency assembly excludes build dependencies without altering the build stage', async () => {
  const dockerfile = await readFile(new URL('backend/Dockerfile.prod', root), 'utf8')
  const build = dockerfile.slice(0, dockerfile.indexOf(' AS deps'))
  const deps = dockerfile.slice(dockerfile.indexOf(' AS deps'), dockerfile.indexOf(' AS runtime-root'))
  assert.match(build, /pnpm install --frozen-lockfile --filter webmodeler-backend\.\.\./)
  assert.doesNotMatch(build, /pnpm install --prod/)
  assert.match(deps, /pnpm install --prod --frozen-lockfile --filter webmodeler-backend\.\.\./)
  assert.match(dockerfile, /COPY --from=deps \/repo\/packages\/shared\/node_modules/)
})

const backendRequire = createRequire(new URL('backend/package.json', root))
const mssqlRequire = createRequire(backendRequire.resolve('mssql'))
const tediousRequire = createRequire(mssqlRequire.resolve('tedious'))

// Exercise the actual Azure Identity dependency loaded by Tedious. Only the
// HTTP boundary is synthetic: no provider, ambient credential or network call.
const identityRequire = createRequire(tediousRequire.resolve('@azure/identity'))
const { ClientSecretCredential, AuthenticationRequiredError } = tediousRequire('@azure/identity')
const { createHttpHeaders } = identityRequire('@azure/core-rest-pipeline')
const credentialTenantA = '11111111-1111-4111-8111-111111111111'
const credentialTenantB = '22222222-2222-4222-8222-222222222222'
const credentialClient = '33333333-3333-4333-8333-333333333333'
const credentialScope = 'https://database.windows.net/.default'
function azureCredentialWire(rejectToken = false) {
  const calls = []
  return {
    calls,
    async sendRequest(request) {
      const url = new URL(request.url)
      assert.equal(url.origin, 'https://login.microsoftonline.com')
      const tenant = url.pathname.split('/')[1]
      assert.ok([credentialTenantA, credentialTenantB].includes(tenant))
      calls.push({ method: request.method, path: url.pathname })
      let body
      let status = 200
      if (request.method === 'GET' && url.pathname.endsWith('/.well-known/openid-configuration')) {
        body = {
          authorization_endpoint: `${url.origin}/${tenant}/oauth2/v2.0/authorize`,
          token_endpoint: `${url.origin}/${tenant}/oauth2/v2.0/token`,
          issuer: `${url.origin}/${tenant}/v2.0`,
          jwks_uri: `${url.origin}/${tenant}/discovery/v2.0/keys`,
        }
      } else {
        assert.equal(request.method, 'POST')
        assert.equal(url.pathname, `/${tenant}/oauth2/v2.0/token`)
        const form = new URLSearchParams(request.body)
        assert.equal(form.get('client_id'), credentialClient)
        assert.equal(form.get('grant_type'), 'client_credentials')
        assert.equal(form.get('scope'), credentialScope)
        assert.equal(form.get('client_secret'), `synthetic-${tenant}`)
        if (rejectToken) {
          status = 400
          body = { error: 'invalid_client', error_description: 'Synthetic credential rejection' }
        } else {
          body = { access_token: `synthetic-token-${tenant}`, token_type: 'Bearer', expires_in: 3600,
            ext_expires_in: 3600, scope: credentialScope }
        }
      }
      return { request, status, headers: createHttpHeaders({ 'content-type': 'application/json' }), bodyAsText: JSON.stringify(body) }
    },
  }
}
const sqlCredential = (tenant, httpClient) => new ClientSecretCredential(tenant, credentialClient, `synthetic-${tenant}`, {
  authorityHost: 'https://login.microsoftonline.com', disableInstanceDiscovery: true, httpClient,
  retryOptions: { maxRetries: 0 },
})

test('Tedious Azure Identity acquires and caches a SQL token through the patched MSAL release', async () => {
  assert.ok(isAtLeast(identityRequire('@azure/msal-node').version, [7, 1, 0]))
  const wire = azureCredentialWire()
  const credential = sqlCredential(credentialTenantA, wire)
  const first = await credential.getToken(credentialScope)
  const repeated = await credential.getToken(credentialScope)
  assert.equal(first.token, `synthetic-token-${credentialTenantA}`)
  assert.equal(repeated.token, first.token)
  assert.ok(first.expiresOnTimestamp > Date.now())
  assert.equal(wire.calls.filter(call => call.method === 'POST').length, 1)
})

test('Tedious Azure Identity retains separate tenant token caches with the upgraded MSAL dependency', async () => {
  const wire = azureCredentialWire()
  const a = await sqlCredential(credentialTenantA, wire).getToken(credentialScope)
  const b = await sqlCredential(credentialTenantB, wire).getToken(credentialScope)
  assert.notEqual(a.token, b.token)
  assert.equal(a.token, `synthetic-token-${credentialTenantA}`)
  assert.equal(b.token, `synthetic-token-${credentialTenantB}`)
  assert.equal(wire.calls.filter(call => call.method === 'POST').length, 2)
})

test('Tedious Azure Identity propagates credential refusal without a fallback or accepted token', async () => {
  const wire = azureCredentialWire(true)
  await assert.rejects(sqlCredential(credentialTenantA, wire).getToken(credentialScope), error =>
    error instanceof AuthenticationRequiredError && error.message.includes('invalid_client'))
  assert.equal(wire.calls.filter(call => call.method === 'POST').length, 1)
})

test('the SQL Server driver retains its real package identity and no longer loads sprintf-js', async () => {
  const lock = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  assert.doesNotMatch(lock, /^ {2}sprintf-js@/m)
  assert.equal(tediousRequire('../package.json').version, '20.0.0')
  for (const name of ['value-parser', 'packet', 'login7-payload', 'metadata-parser', 'prelogin-payload']) {
    const source = await readFile(tediousRequire.resolve(`./${name}.js`), 'utf8')
    assert.doesNotMatch(source, /require\(["']sprintf-js["']\)/)
    assert.match(source, /require\(["']\.\/bounded-format["']\)/)
  }
  assert.throws(() => tediousRequire('sprintf-js'), { code: 'MODULE_NOT_FOUND' })
})

test('bounded driver diagnostics preserve decimal, string and unsigned zero-padded hexadecimal output', () => {
  const { sprintf } = tediousRequire('./bounded-format.js')
  assert.equal(sprintf('type:0x%02X(%s), length:0x%04X', 4, 'RESPONSE', 42), 'type:0x04(RESPONSE), length:0x002A')
  assert.equal(sprintf('TDS:0x%08X, ClientTimezone:%d', 1946157060, -60), 'TDS:0x74000004, ClientTimezone:-60')
  assert.equal(sprintf('%08X %04X %02X', -1, 65536, 255), 'FFFFFFFF 10000 FF')
  assert.equal(sprintf('Unrecognised type %s', '%.999999999f'), 'Unrecognised type %.999999999f')
  assert.equal(sprintf('100%%'), '100%')
})

test('bounded driver diagnostics reject precision, unsupported padding and malformed formats before allocation', () => {
  const { sprintf } = tediousRequire('./bounded-format.js')
  for (const format of ['%.101f', '%.999999999e', '%.0g', '%999999999s', '%09X', '%*s', '%(name)s', '%']) {
    assert.throws(() => sprintf(format, 1), /Unsupported Tedious diagnostic format/)
  }
  assert.throws(() => sprintf('x'.repeat(4097)), /Unsupported/)
  assert.throws(() => sprintf('%d'), /Missing/)
  assert.throws(() => sprintf('literal', 1), /Unexpected/)
})

test('every installed driver diagnostic literal is handled by the bounded formatter', async () => {
  const { sprintf } = tediousRequire('./bounded-format.js')
  let count = 0
  for (const name of ['value-parser', 'packet', 'login7-payload', 'metadata-parser', 'prelogin-payload']) {
    const source = await readFile(tediousRequire.resolve(`./${name}.js`), 'utf8')
    for (const match of source.matchAll(/_sprintfJs\.sprintf\)\((['"])(.*?)\1/g)) {
      const tokens = [...match[2].matchAll(/%(?:0[1-8])?([dsX])/g)]
      const args = tokens.map(token => token[1] === 's' ? 'fixture' : 1)
      assert.equal(typeof sprintf(match[2], ...args), 'string')
      count++
    }
  }
  assert.equal(count, 12, 'all pinned driver call sites must remain covered')
})

test('every Docker workspace install receives the source patch before dependency resolution', async () => {
  for (const file of [
    'backend/Dockerfile', 'backend/Dockerfile.prod', 'frontend/Dockerfile', 'frontend/Dockerfile.prod',
    'packages/plugin-installer/Dockerfile', 'packages/plugin-manager/Dockerfile',
    'packages/plugin-reference/Dockerfile', 'infra/docker/managed-shard-bootstrap/Dockerfile',
  ]) {
    const source = await readFile(new URL(file, root), 'utf8')
    for (const stage of source.split(/^FROM /m).slice(1)) {
      const instructions = stage.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
      const install = instructions.indexOf('pnpm install')
      if (install < 0) continue
      const copy = instructions.search(/^COPY (?:--chown=[^ ]+ )?patches patches$/m)
      assert.ok(copy >= 0 && copy < install, `${file}: patch must precede each workspace install`)
    }
  }
})


test('runtime OS floors invalidate stale zlib and glibc layers and application Node stays on the declared major', async () => {
  for (const relative of ['backend/Dockerfile.prod', 'frontend/Dockerfile.prod', 'infra/docker/managed-shard-bootstrap/Dockerfile']) {
    const source = await readFile(new URL(relative, root), 'utf8');
    assert.match(source, /zlib>=1\.3\.2\.1_rc20260921-r0/);
    assert.match(source, /glibc-2\.44>=2\.44-r8/);
    assert.match(source, /glibc-2\.44-locale-posix>=2\.44-r8/);
    assert.match(source, /ld-linux-2\.44>=2\.44-r8/);
    assert.match(source, /libcrypt1-2\.44>=2\.44-r8/);
    assert.match(source, /ca-certificates-bundle>=20260909-r3/);
    assert.match(source, /libcurl-openssl4>=8\.23\.0-r0/);
  }
  const backend = await readFile(new URL('backend/Dockerfile.prod', root), 'utf8');
  assert.match(backend, /nodejs-24=24\.21\.0-r4/);
  assert.match(backend, /nodejs\|npm\|node-gyp\|corepack/);
  assert.match(backend, /process\.versions\.node\.split\("\."\)\[0\] !== "24"/);
});

test('both acquisition toolchains require the patched certificate verification standard library in the emitted binaries', async () => {
  for (const relative of ['packages/plugin-installer/Dockerfile', 'packages/plugin-manager/Dockerfile']) {
    const source = await readFile(new URL(relative, root), 'utf8');
    assert.match(source, /golang:1\.26\.10-alpine3\.23@sha256:a07f231c19b03e6106cf442f02a5bcf262147e744d15b7b5e4b6d81d420c70a0/);
    assert.ok(source.includes('^/out/oras: go1\\.26\\.10$'));
    assert.ok(source.includes('^/out/cosign: go1\\.26\\.10$'));
  }
});
