import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

const image = process.env.FRONTEND_TEST_IMAGE || 'eg-local-frontend:pr'
const subnet = process.env.FRONTEND_TEST_SUBNET
const nodeImage = 'node:24-alpine'
const mount = '/run/secrets/enterpriseglue-upstream'
const host = 'app.example.test'
const tlsName = 'api.internal.example'
const localHealth = '/_enterpriseglue/frontend-health'

function run(command, ...args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim()
}

function getFrontend(address, path) {
  return new Promise((resolve, reject) => {
    get(address + path, { headers: { Host: host }, signal: AbortSignal.timeout(3_000) }, (response) => {
      const body = []
      response.on('data', (chunk) => body.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(body).toString('utf8'),
      }))
      response.on('error', reject)
    }).on('error', reject)
  })
}

function certificates(directory, frontendSecrets) {
  function issue(name, usage, subject, issuer = 'ca') {
    const base = join(directory, name)
    const ca = join(directory, issuer)
    writeFileSync(base + '.ext', usage + '\n')
    run('openssl', 'req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-subj', '/CN=' + subject, '-out', base + '.csr', '-keyout', base + '.key')
    run('openssl', 'x509', '-req', '-in', base + '.csr', '-CA', ca + '.crt', '-CAkey', ca + '.key',
      '-CAcreateserial', '-days', '2', '-extfile', base + '.ext', '-out', base + '.crt')
  }

  for (const ca of ['ca', 'other-ca']) {
    run('openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-days', '2', '-subj', '/CN=' + ca, '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      '-out', join(directory, ca + '.crt'), '-keyout', join(directory, ca + '.key'))
  }
  issue('server', 'extendedKeyUsage=serverAuth\nsubjectAltName=DNS:' + tlsName, tlsName)
  issue('client', 'extendedKeyUsage=clientAuth', 'frontend')
  issue('other-client', 'extendedKeyUsage=clientAuth', 'other-frontend', 'other-ca')
  for (const name of ['ca.crt', 'client.crt', 'client.key', 'other-client.crt', 'other-client.key']) {
    const destination = join(frontendSecrets, name)
    copyFileSync(join(directory, name), destination)
    // Generated test material lives in a private temporary directory. The
    // bind mount must also be readable by the production image's non-root UID.
    chmodSync(destination, 0o444)
  }
  writeFileSync(join(frontendSecrets, 'invalid.crt'), 'invalid PEM\n', { mode: 0o444 })
}

const gateway = String.raw`
import { createServer as http } from 'node:http'
import { createServer as https } from 'node:https'
import { readFileSync } from 'node:fs'

function respond(req, res) {
  if (req.url === '/api/auth/start') {
    res.writeHead(302, {
      Location: 'https://' + req.headers.host + '/callback',
      'Set-Cookie': 'state=fixture; Path=/; Secure; HttpOnly',
    }).end()
    return
  }
  res.end(JSON.stringify({
    url: req.url,
    host: req.headers.host,
    forwardedProto: req.headers['x-forwarded-proto'],
    sni: req.socket.servername || null,
    clientVerified: req.socket.authorized === true,
  }))
}

const tls = {
  cert: readFileSync('/fixture/server.crt'),
  key: readFileSync('/fixture/server.key'),
  ca: readFileSync('/fixture/ca.crt'),
}
http(respond).listen(8787)
https(tls, respond).listen(8443)
https({ ...tls, requestCert: true, rejectUnauthorized: true }, respond).listen(9443)
`

test('production NGINX validates upstream TLS and mTLS across the frontend API boundary', { timeout: 180_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'eg-upstream-tls-'))
  const network = 'eg-upstream-tls-' + process.pid
  const gatewayName = network + '-gateway'
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const secretDirectory = join(directory, 'frontend')
  mkdirSync(secretDirectory, { mode: 0o755 })
  certificates(directory, secretDirectory)

  run('docker', 'network', 'create', ...(subnet ? ['--subnet', subnet] : []), network)
  t.after(() => {
    spawnSync('docker', ['rm', '-f', gatewayName], { timeout: 10_000 })
    run('docker', 'network', 'rm', network)
  })
  run('docker', 'run', '-d', '--rm', '--name', gatewayName, '--network', network,
    '--network-alias', 'backend', '--network-alias', tlsName,
    '--mount', 'type=bind,src=' + directory + ',dst=/fixture,readonly', nodeImage,
    'node', '--input-type=module', '-e', gateway)

  const frontendArgs = (env) => [
    '--network', network, '--mount', 'type=bind,src=' + secretDirectory + ',dst=' + mount + ',readonly',
    ...Object.entries(env).flatMap(([key, value]) => ['--env', key + '=' + value]),
  ]

  async function startFrontend(subtest, env) {
    const name = network + '-frontend'
    const container = run('docker', 'run', '-d', '--name', name, '-p', '127.0.0.1::8080', ...frontendArgs(env), image)
    subtest.after(() => run('docker', 'rm', '-f', container))
    const address = 'http://' + run('docker', 'port', container, '8080/tcp')
    const request = (path) => getFrontend(address, path)
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request(localHealth).catch(() => undefined)
      if (response?.status === 204) return request
      await delay(125)
    }
    assert.fail('Frontend did not become live:\n' + run('docker', 'logs', container))
  }

  const tls = {
    API_UPSTREAM_SCHEME: 'https',
    API_UPSTREAM: tlsName + ':8443',
    API_UPSTREAM_TLS_CA_FILE: mount + '/ca.crt',
  }
  const mtls = {
    ...tls,
    API_UPSTREAM: 'backend:9443',
    API_UPSTREAM_TLS_SERVER_NAME: tlsName,
    API_UPSTREAM_TLS_CLIENT_CERT_FILE: mount + '/client.crt',
    API_UPSTREAM_TLS_CLIENT_KEY_FILE: mount + '/client.key',
  }

  await t.test('the default API upstream still serves HTTP', async (subtest) => {
    const request = await startFrontend(subtest, {})
    const response = await request('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), { url: '/health', host, forwardedProto: 'http', sni: null, clientVerified: false })
  })

  await t.test('HTTPS defaults the TLS name to the upstream hostname', async (subtest) => {
    const request = await startFrontend(subtest, tls)
    const response = await request('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), { url: '/health', host, forwardedProto: 'http', sni: tlsName, clientVerified: false })
  })

  await t.test('mTLS presents the client certificate and uses the configured TLS name for all API locations', async (subtest) => {
    const request = await startFrontend(subtest, mtls)
    for (const path of [
      '/health', '/api/example?limit=2', '/t/team/api/example',
      '/api/plugins/v1/fixture/operations/start', '/t/team/api/plugins/v1/fixture/operations/start',
      '/_enterpriseglue/plugins/fixture/frontend.js', '/t/team/_enterpriseglue/plugins/fixture/frontend.js',
    ]) {
      const response = await request(path)
      assert.equal(response.status, 200, path)
      assert.deepEqual(JSON.parse(response.body), { url: path, host, forwardedProto: 'http', sni: tlsName, clientVerified: true })
    }
    const redirect = await request('/api/auth/start')
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.location, 'https://' + host + '/callback')
    assert.deepEqual(redirect.headers['set-cookie'], ['state=fixture; Path=/; Secure; HttpOnly'])
    const browserConfig = await request('/.well-known/enterpriseglue/runtime-config.json')
    assert.equal(browserConfig.status, 200)
    assert.deepEqual(JSON.parse(browserConfig.body), { required: false })
  })

  for (const [label, env] of [
    ['untrusted upstream CA', { ...tls, API_UPSTREAM_TLS_CA_FILE: '' }],
    ['wrong upstream certificate hostname', { ...tls, API_UPSTREAM_TLS_SERVER_NAME: 'wrong.example.test' }],
    ['mTLS gateway without a client certificate', { ...tls, API_UPSTREAM: tlsName + ':9443' }],
    ['mTLS gateway with an untrusted client certificate', {
      ...mtls, API_UPSTREAM_TLS_CLIENT_CERT_FILE: mount + '/other-client.crt', API_UPSTREAM_TLS_CLIENT_KEY_FILE: mount + '/other-client.key',
    }],
    ['HTTPS to a plaintext endpoint', { ...tls, API_UPSTREAM: 'backend:8787' }],
  ]) {
    await t.test(label + ' fails the request while NGINX stays live', async (subtest) => {
      const request = await startFrontend(subtest, env)
      assert.equal((await request('/health')).status, 502)
      assert.equal((await request(localHealth)).status, 204)
    })
  }

  await t.test('invalid TLS configuration fails before serving traffic', () => {
    for (const [env, diagnostic] of [
      [{ API_UPSTREAM_SCHEME: 'ftp' }, /API_UPSTREAM_SCHEME must be http or https/],
      [{ API_UPSTREAM: 'backend:8787\ninvalid' }, /API_UPSTREAM must be a hostname or IP address/],
      [{ API_UPSTREAM_TLS_CA_FILE: mount + '/ca.crt' }, /settings require API_UPSTREAM_SCHEME=https/],
      [{ ...tls, API_UPSTREAM_TLS_SERVER_NAME: 'name;\nproxy_ssl_verify off' }, /must be a DNS name/],
      [{ ...tls, API_UPSTREAM_TLS_CA_FILE: mount + '/missing.crt' }, /API_UPSTREAM_TLS_CA_FILE must be an absolute, readable file path/],
      [{ ...tls, API_UPSTREAM_TLS_CA_FILE: mount + '/invalid.crt' }, /invalid\.crt.*(?:failed|error)/],
      [{ ...mtls, API_UPSTREAM_TLS_CLIENT_KEY_FILE: '' }, /Set both .* for mTLS/],
      [{ ...mtls, API_UPSTREAM_TLS_CLIENT_KEY_FILE: mount + '/other-client.key' }, /key values mismatch/],
    ]) {
      const result = spawnSync('docker', ['run', '--rm', ...frontendArgs(env), image, 'nginx', '-t'], {
        encoding: 'utf8', timeout: 10_000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, diagnostic)
    }
  })
})
