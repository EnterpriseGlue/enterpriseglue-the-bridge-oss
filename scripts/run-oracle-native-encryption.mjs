#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyOracleSessions } from './verify-oracle-session-encryption.mjs';

const root = path.resolve(import.meta.dirname, '..');
const container = `eg-nne-${randomBytes(6).toString('hex')}`;
const temporary = mkdtempSync(path.join(tmpdir(), 'eg-nne-'));
const image = process.env.ORACLE_NNE_TEST_IMAGE || 'eg-oracle-nne:local';
const databaseImage = 'gvenzl/oracle-free:23-slim-faststart@sha256:f5ff19033860d662c821cb04eb10483fa94f14f78eae252d054291ea07028093';
const password = randomBytes(24).toString('hex');
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const observations = [];
const requestedScenarios = process.env.ORACLE_NNE_TEST_SCENARIOS?.split(',');
const directory = path.join(root, '.artifacts/oracle-nne');
mkdirSync(directory, { recursive: true });
const evidenceFile = path.join(directory, requestedScenarios ? 'selected-negotiation.json' : 'negotiation.json');
const startedAt = new Date().toISOString();
function record(status) {
  writeFileSync(evidenceFile, JSON.stringify({ status, startedAt, image, databaseImage, requestedScenarios, observations }, null, 2) + '\n');
}
record('running');
writeFileSync(path.join(temporary, 'sqlnet.ora'), 'SQLNET.ENCRYPTION_CLIENT=REQUIRED\nSQLNET.ENCRYPTION_TYPES_CLIENT=(AES256)\n');
// Mount only a disposable, non-secret test program into the production image.
writeFileSync(path.join(temporary, 'check.mjs'), `
import assert from 'node:assert/strict';
try {
  const { getConnectionPool, closeConnectionPool } = await import('/app/dist/packages/shared/dist/db/db-pool.js');
  // OracleDriver can initialize OCI in its constructor. Import the ORM only
  // after the raw-first attempt so these cases exercise the raw initializer.
  if (process.env.EG_NNE_TEST_LEGACY_FIRST === 'true') await getConnectionPool().query('SELECT 1 FROM dual');
  const { getDataSource, closeDataSource } = await import('/app/dist/packages/shared/dist/db/data-source.js');
  const sources = await Promise.all(Array.from({length:3},()=>getDataSource()));
  assert.ok(sources.every(source=>source===sources[0]));
  const ds = sources[0];
  if (process.env.EG_NNE_TEST_UPGRADE === 'true') {
    const { ExpandOracleAssignmentKeys1700000000134 } = await import('/app/dist/packages/shared/dist/db/migrations/oracle/1700000000134-expand-oracle-assignment-keys.js');
    const tables = ['role_assignments', 'config_role_assignment_overrides'];
    for (let i=0;i<tables.length;i++) {
      await ds.query('CREATE TABLE "ENTERPRISEGLUE"."'+tables[i]+'" ("assignment_key" VARCHAR2(191 BYTE) NOT NULL, CONSTRAINT "eg_nne_key_'+i+'" UNIQUE ("assignment_key"))');
      await ds.query('INSERT INTO "ENTERPRISEGLUE"."'+tables[i]+'" ("assignment_key") VALUES (:1)', ['prior-grant']);
    }
    const migration = new ExpandOracleAssignmentKeys1700000000134();
    const runner = ds.createQueryRunner(); await migration.up(runner); await runner.release();
    const again = ds.createQueryRunner(); await migration.up(again); await again.release();
    for (let i=0;i<tables.length;i++) {
      const key='組織'.repeat(120);
      await ds.query('INSERT INTO "ENTERPRISEGLUE"."'+tables[i]+'" ("assignment_key") VALUES (:1)', [key]);
      const rows=await ds.query('SELECT "assignment_key" AS KEY FROM "ENTERPRISEGLUE"."'+tables[i]+'"');
      assert.deepEqual(new Set(rows.map(row=>row.KEY)),new Set(['prior-grant',key]));
      const indexes=await ds.query('SELECT STATUS FROM USER_INDEXES WHERE INDEX_NAME=:1',['eg_nne_key_'+i]);
      assert.equal(indexes[0].STATUS,'VALID');
    }
    console.log('EG_NNE_UPGRADE_PRESERVED');
  }
  const held = [];
  for (let i=0;i<3;i++) { const runner=ds.createQueryRunner(); await runner.connect(); held.push(runner); }
  const sids = await Promise.all(held.map(r=>r.query("SELECT SYS_CONTEXT('USERENV','SID') AS SID FROM dual")));
  assert.equal(new Set(sids.map(rows=>String(rows[0].SID))).size,3);
  const pool=getConnectionPool(); await Promise.all(Array.from({length:3},()=>pool.query('SELECT 1 FROM dual')));
  const legacy=await pool.getNativePool().getConnection();
  await legacy.execute('SELECT 1 FROM dual');
  console.log('EG_NNE_HELD');
  await new Promise(resolve=>setTimeout(resolve,10000));
  await legacy.close(); await Promise.all(held.map(r=>r.release()));
  await closeConnectionPool(); await closeDataSource();
  console.log('EG_NNE_SUCCESS');
} catch (error) {
  console.log('EG_NNE_ERROR_CODE|' + String(error.code || error.errorNum || error.name));
  console.log('EG_NNE_CONNECTION_FAILED'); process.exitCode=1;
}
`);

async function scenario(name, serverMode, serverCipher, { failure = false, mode = 'native-aes256-required', missingLibraries = false, upgrade = false, legacyFirst = false, connectString = '127.0.0.1:1521/FREEPDB1' } = {}) {
  if (requestedScenarios && !requestedScenarios.includes(name)) return;
  docker(['exec', '-i', container, 'bash', '-c', 'cat > "$ORACLE_HOME/network/admin/sqlnet.ora"'], {
    input: `SQLNET.ENCRYPTION_SERVER=${serverMode}\nSQLNET.ENCRYPTION_TYPES_SERVER=(${serverCipher})\n`,
  });
  const args = ['run', '--rm', '--network', `container:${container}`, '--entrypoint', 'node',
    '-v', `${temporary}:/test:ro`, '-e', 'DATABASE_TYPE=oracle', '-e', 'ORACLE_USER=enterpriseglue',
    '-e', `ORACLE_PASSWORD=${password}`, '-e', 'ORACLE_SCHEMA=ENTERPRISEGLUE',
    '-e', `ORACLE_CONNECTION_STRING=${connectString}`,
    '-e', `ORACLE_NETWORK_ENCRYPTION=${mode}`, '-e', 'NODE_ENV=test',
    '-e', `JWT_SECRET=${password}`, '-e', `ADMIN_PASSWORD=${password}`,
    '-e', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`];
  if (mode !== 'default') args.push('-e', 'ORACLE_NET_CONFIG_DIR=/test');
  if (missingLibraries) args.push('-e', 'LD_LIBRARY_PATH=/missing-oracle-libraries');
  if (upgrade) args.push('-e', 'EG_NNE_TEST_UPGRADE=true');
  if (legacyFirst) args.push('-e', 'EG_NNE_TEST_LEGACY_FIRST=true');
  args.push(image, '/test/check.mjs');
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', code => resolve(code));
  });
  let held = false;
  let evidence;
  let evidenceError;
  const collect = async () => {
    try { evidence = verifyOracleSessions(container); } catch (error) { evidenceError = error; }
  };
  let evidencePromise;
  child.stdout.on('data', chunk => {
    output += String(chunk);
    if (!held && output.includes('EG_NNE_HELD')) {
      held = true;
      if (mode !== 'default') evidencePromise = collect();
    }
  });
  // Native diagnostics are intentionally kept out of retained artifacts.
  child.stderr.on('data', () => {});
  const timeout = setTimeout(() => child.kill('SIGTERM'), 90_000);
  const code = await completed;
  clearTimeout(timeout);
  await evidencePromise;
  if (failure) {
    assert.notEqual(code, 0, `${name} unexpectedly connected`);
    assert.ok(output.includes('EG_NNE_CONNECTION_FAILED'), `${name} did not exercise the connection failure path`);
  } else {
    assert.equal(code, 0, `${name} failed to connect ${output.match(/EG_NNE_ERROR_CODE\|([^\n]+)/)?.[1] || ''}`);
    assert.ok(output.includes('EG_NNE_SUCCESS'), `${name} did not finish both pool paths`);
    if (upgrade) assert.ok(output.includes('EG_NNE_UPGRADE_PRESERVED'), 'Oracle upgrade did not preserve data and indexes');
    if (mode !== 'default') { if (evidenceError) throw evidenceError; assert.ok(evidence); }
  }
  observations.push({ name, status: 'passed', expected: failure ? 'connection-rejected' : 'connected', evidence });
  record('running');
  console.log(`[oracle-nne] ${name}: passed`);
}

try {
  docker(['run', '-d', '--name', container, '-e', `ORACLE_PASSWORD=${password}`, '-e', 'APP_USER=enterpriseglue',
    '-e', `APP_USER_PASSWORD=${password}`, databaseImage]);
  let ready = false;
  for (let i=0;i<120;i++) {
    try { docker(['exec', container, 'healthcheck.sh'], { stdio: 'ignore' }); ready=true; break; } catch { await delay(5000); }
  }
  assert.ok(ready, 'Disposable Oracle database did not become healthy');
  await scenario('server-requested', 'REQUESTED', 'AES256');
  await scenario('server-required', 'REQUIRED', 'AES256');
  await scenario('server-accepted', 'ACCEPTED', 'AES256');
  await scenario('server-rejected', 'REJECTED', 'AES256', { failure: true });
  await scenario('cipher-mismatch', 'REQUESTED', 'AES128', { failure: true });
  await scenario('missing-client-libraries', 'REQUESTED', 'AES256', { failure: true, missingLibraries: true });
  await scenario('legacy-first-requested', 'REQUESTED', 'AES256', { legacyFirst: true });
  await scenario('legacy-server-rejected', 'REJECTED', 'AES256', { failure: true, legacyFirst: true });
  await scenario('legacy-cipher-mismatch', 'REQUESTED', 'AES128', { failure: true, legacyFirst: true });
  await scenario('legacy-missing-libraries', 'REQUESTED', 'AES256', { failure: true, legacyFirst: true, missingLibraries: true });
  await scenario('default-without-nne', 'REJECTED', 'AES256', { mode: 'default' });
  // Re-open every process and pool after negative cases to prove recovery does
  // not retain a permissive profile or a stale connection.
  await scenario('reconnect-after-failures', 'REQUIRED', 'AES256');
  await scenario('oracle-key-upgrade', 'REQUIRED', 'AES256', { upgrade: true });
  const ha = '(DESCRIPTION=(CONNECT_TIMEOUT=60)(TRANSPORT_CONNECT_TIMEOUT=2)(ADDRESS_LIST=(LOAD_BALANCE=OFF)(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1))(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))';
  await scenario('tcp-ha-descriptor', 'REQUIRED', 'AES256', { connectString: ha });
  writeFileSync(path.join(temporary, 'tnsnames.ora'), `APP=${ha}\n`);
  await scenario('dedicated-tns-alias', 'REQUIRED', 'AES256', { connectString: 'APP' });
  assert.ok(observations.length > 0, 'No Oracle negotiation scenarios were selected');
  if (requestedScenarios) assert.equal(observations.length, new Set(requestedScenarios).size, 'Unknown Oracle negotiation scenario');
  record('passed');
} catch (error) {
  record('failed');
  throw error;
} finally {
  try { docker(['rm','-f','-v',container],{stdio:'ignore'}); } catch { /* Own disposable container only. */ }
  rmSync(temporary,{recursive:true,force:true});
}
