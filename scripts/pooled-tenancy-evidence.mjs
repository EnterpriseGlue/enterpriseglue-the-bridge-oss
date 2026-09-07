import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stages = new Set(['preflight', 'build', 'startup', 'database', 'browser', 'complete', 'cleanup']);

// Deliberately not a general log redactor. No strings or files from the raw
// diagnostic tree (including screenshots and ZIP traces) cross this boundary.
export function writeReceipt({ output, status, stage, exitCode, isolationFile }) {
  if (!['running', 'passed', 'failed'].includes(status) || !stages.has(stage)
      || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new Error('invalid receipt control fields');
  }
  let isolation = null;
  try {
    const stat = lstatSync(isolationFile);
    if (!stat.isFile() || stat.size > 4096) throw new Error('invalid isolation input');
    const data = JSON.parse(readFileSync(isolationFile, 'utf8'));
    if (data.superuser === false && data.bypass_rls === false
        && Number.isSafeInteger(data.forced_tenant_policy_tables)
        && data.forced_tenant_policy_tables > 0 && data.forced_tenant_policy_tables <= 10000) {
      isolation = { superuser: false, bypassRls: false, forcedTenantPolicyTables: data.forced_tenant_policy_tables };
    }
  } catch { /* Missing or malformed evidence cannot qualify a passing run. */ }
  const passed = status === 'passed' && stage === 'complete' && exitCode === 0 && isolation !== null;
  const receipt = {
    schemaVersion: 1,
    evidenceKind: 'pooled-tenancy-browser-emulators',
    status: status === 'running' ? 'running' : passed ? 'passed' : 'failed',
    stage,
    exitCode,
    databaseIsolation: isolation,
    publicEdgeQualified: false,
    rawDiagnosticsExported: false,
  };
  const parent = dirname(resolve(output));
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(parent, '.receipt-'));
  try {
    const file = join(temporary, 'receipt.json');
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    // Replace even a stale receipt or symlink, without following its target.
    renameSync(file, resolve(output));
  } finally { rmdirSync(temporary); }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [output, status, stage, exitCode, isolationFile] = process.argv.slice(2);
    const receipt = writeReceipt({ output, status, stage, exitCode: Number(exitCode), isolationFile });
    if (status === 'passed' && receipt.status !== 'passed') process.exitCode = 1;
  } catch {
    // Never echo exceptions, paths, input content, or authentication material.
    console.error('[pooled-tenancy-e2e] Evidence receipt could not be written.');
    process.exitCode = 1;
  }
}
