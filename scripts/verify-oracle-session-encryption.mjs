#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

export function parseEncryptionEvidence(output) {
  const match = output.match(/EG_NNE_COUNTS\|(\d+)\|(\d+)/);
  assert.ok(match, 'Oracle did not return session encryption evidence.');
  const sessions = Number(match[1]);
  const unencrypted = Number(match[2]);
  assert.ok(sessions > 0, 'No application sessions were observed.');
  assert.equal(unencrypted, 0, 'Application sessions without negotiated AES256 were observed.');
  return { status: 'passed', algorithm: 'AES256', sessions, unencrypted };
}

export function verifyOracleSessions(container, username = 'ENTERPRISEGLUE') {
  assert.match(container, /^[a-zA-Z0-9_.-]+$/);
  assert.match(username, /^[A-Z][A-Z0-9_]*$/);
  const sql = `WHENEVER SQLERROR EXIT FAILURE
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 VERIFY OFF ECHO OFF
ALTER SESSION SET CONTAINER=FREEPDB1;
SELECT 'EG_NNE_COUNTS|' || COUNT(*) || '|' || NVL(SUM(CASE WHEN NOT EXISTS (
 SELECT 1 FROM v$session_connect_info i WHERE i.sid=s.sid AND i.serial#=s.serial#
 AND i.network_service_banner LIKE 'AES256 Encryption service adapter%'
) THEN 1 ELSE 0 END),0) FROM v$session s WHERE s.username='${username}';
EXIT;
`;
  // Local OS-authenticated fixture DBA; no application credential or catalog
  // privilege is added to the production account. Output contains counts only.
  const output = execFileSync('docker', ['exec', '-i', container, 'sqlplus', '-s', '/', 'as', 'sysdba'], { input: sql, encoding: 'utf8' });
  return parseEncryptionEvidence(output);
}

if (process.argv[1]?.endsWith('/verify-oracle-session-encryption.mjs')) {
  console.log(JSON.stringify(verifyOracleSessions(process.argv[2], process.argv[3]), null, 2));
}
