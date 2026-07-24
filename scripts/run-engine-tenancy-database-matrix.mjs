#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'test/database/engine-tenancy-database-matrix-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const releaseDirectory = path.join(root, 'test/results/engine-tenancy-release');
const observationDirectory = path.join(releaseDirectory, 'database-observations');
const outputPath = path.join(releaseDirectory, 'database-matrix.json');
const allowDirty = process.argv.includes('--allow-dirty');
const keepContainers = process.argv.includes('--keep-containers');
const requestedDatabase = process.argv
  .find((argument) => argument.startsWith('--database='))
  ?.slice('--database='.length);
const selectedDatabases = requestedDatabase
  ? [requestedDatabase]
  : Object.keys(contract.databases);
const backendRequire = createRequire(path.join(root, 'backend/package.json'));

function command(commandName, args, options = {}) {
  const result = execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return typeof result === 'string' ? result.trim() : '';
}

function gitValue(args) {
  return command('git', args);
}

const startCommit = gitValue(['rev-parse', 'HEAD']);
const startChanges = gitValue(['status', '--porcelain', '--untracked-files=all']);
if (startChanges && !allowDirty) {
  throw new Error('Database-matrix evidence must be run from a clean worktree');
}
for (const database of selectedDatabases) {
  if (!contract.databases[database]) {
    throw new Error(`Unknown database target: ${database}`);
  }
}

function containerName(database) {
  return `eg-engine-tenancy-dbq-${database}`;
}

function docker(args, options = {}) {
  return command('docker', args, options);
}

function removeContainer(database) {
  spawnSync('docker', ['rm', '-f', '-v', containerName(database)], {
    cwd: root,
    stdio: 'ignore',
  });
}

function boundedLog(value, maxLines = 40, maxCharactersPerLine = 1000) {
  return String(value || '')
    .split('\n')
    .slice(-maxLines)
    .map((line) => line.slice(0, maxCharactersPerLine));
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setTimeout(1500);
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error('connection timeout'));
        });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Port 127.0.0.1:${port} did not become ready: ${lastError?.message || 'timeout'}`);
}

function dockerRunArguments(database) {
  const target = contract.databases[database];
  const common = [
    'run',
    '--detach',
    '--name',
    containerName(database),
    '--platform',
    target.platform,
    '--publish',
    `127.0.0.1:${target.port}:${database === 'spanner' ? 9010 : database === 'oracle' ? 1521 : database === 'mssql' ? 1433 : database === 'mysql' ? 3306 : 5432}`,
  ];
  if (database === 'postgres') {
    return [...common,
      '--env', 'POSTGRES_USER=postgres',
      '--env', 'POSTGRES_PASSWORD=postgres',
      '--env', 'POSTGRES_DB=enterpriseglue',
      target.image,
    ];
  }
  if (database === 'mysql') {
    return [...common,
      '--env', 'MYSQL_ROOT_PASSWORD=root',
      '--env', 'MYSQL_DATABASE=enterpriseglue',
      '--env', 'MYSQL_USER=enterpriseglue',
      '--env', 'MYSQL_PASSWORD=enterpriseglue',
      target.image,
    ];
  }
  if (database === 'mssql') {
    return [...common,
      '--env', 'ACCEPT_EULA=Y',
      '--env', 'MSSQL_SA_PASSWORD=EnterpriseGlue1!',
      '--env', 'MSSQL_PID=Developer',
      target.image,
    ];
  }
  if (database === 'oracle') {
    return [...common,
      '--env', 'ORACLE_PASSWORD=enterpriseglue',
      '--env', 'APP_USER=enterpriseglue',
      '--env', 'APP_USER_PASSWORD=enterpriseglue',
      target.image,
    ];
  }
  return [...common, target.image, '/emulator_main', '--host_port=0.0.0.0:9010'];
}

async function retry(label, operation, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}`);
}

async function preparePostgres(target) {
  const pg = backendRequire('pg');
  await retry('PostgreSQL', async () => {
    const client = new pg.Client({
      host: '127.0.0.1',
      port: target.port,
      user: 'postgres',
      password: 'postgres',
      database: 'enterpriseglue',
    });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
  });
}

async function prepareMySql(target) {
  const mysql = backendRequire('mysql2/promise');
  await retry('MySQL', async () => {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: target.port,
      user: 'enterpriseglue',
      password: 'enterpriseglue',
      database: 'enterpriseglue',
    });
    await connection.query('SELECT 1');
    await connection.end();
  });
}

async function prepareMsSql(target) {
  const sql = backendRequire('mssql');
  const serverConfig = {
    server: '127.0.0.1',
    port: target.port,
    user: 'sa',
    password: 'EnterpriseGlue1!',
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true },
  };
  await retry('SQL Server', async () => {
    const pool = await sql.connect(serverConfig);
    await pool.request().query('SELECT 1 AS ready');
    await pool.close();
  }, 300000);
  const pool = await sql.connect(serverConfig);
  await pool.request().query(
    "IF DB_ID(N'enterpriseglue') IS NULL CREATE DATABASE [enterpriseglue]",
  );
  await pool.close();
}

async function prepareOracle(target) {
  const oracle = backendRequire('oracledb');
  await retry('Oracle', async () => {
    const connection = await oracle.getConnection({
      user: 'enterpriseglue',
      password: 'enterpriseglue',
      connectString: `127.0.0.1:${target.port}/XEPDB1`,
    });
    await connection.execute('SELECT 1 FROM dual');
    await connection.close();
  }, 600000);
}

async function prepareSpanner(target) {
  process.env.SPANNER_EMULATOR_HOST = `127.0.0.1:${target.port}`;
  const { Spanner } = await import('@google-cloud/spanner');
  const spanner = new Spanner({ projectId: 'engine-tenancy-local' });
  const instance = spanner.instance('engine-tenancy');
  await retry('Spanner emulator', async () => {
    const [exists] = await instance.exists();
    if (!exists) {
      const [, operation] = await instance.create({
        config: 'emulator-config',
        nodes: 1,
        displayName: 'Engine Tenancy Qualification',
      });
      await operation.promise();
    }
  }, 180000);
  const database = instance.database('enterpriseglue');
  const [exists] = await database.exists();
  if (!exists) {
    const [, operation] = await database.create();
    await operation.promise();
  }
  await spanner.close();
}

async function prepareDatabase(database) {
  const target = contract.databases[database];
  await waitForPort(target.port, database === 'oracle' ? 600000 : 180000);
  if (database === 'postgres') return preparePostgres(target);
  if (database === 'mysql') return prepareMySql(target);
  if (database === 'mssql') return prepareMsSql(target);
  if (database === 'oracle') return prepareOracle(target);
  return prepareSpanner(target);
}

function workerEnvironment(database, observationPath) {
  const target = contract.databases[database];
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_TYPE: database,
    EG_ENV_FILE: path.join(root, 'scripts/local-safe-test.env'),
    JWT_SECRET: 'database-qualification-jwt-secret-000000000000000000000000',
    ADMIN_EMAIL: 'database-qualification@example.invalid',
    ADMIN_PASSWORD: 'database-qualification-password',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    FRONTEND_URL: 'http://localhost:5173',
    ENGINE_TENANCY_DATABASE_OBSERVATION: observationPath,
    ENGINE_TENANCY_DATABASE_VERSION_HINT: target.image,
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: String(target.port),
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DATABASE: 'enterpriseglue',
    POSTGRES_SCHEMA: 'main',
    POSTGRES_SSL: 'false',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: String(target.port),
    MYSQL_USER: 'enterpriseglue',
    MYSQL_PASSWORD: 'enterpriseglue',
    MYSQL_DATABASE: 'enterpriseglue',
    MSSQL_HOST: '127.0.0.1',
    MSSQL_PORT: String(target.port),
    MSSQL_USER: 'sa',
    MSSQL_PASSWORD: 'EnterpriseGlue1!',
    MSSQL_DATABASE: 'enterpriseglue',
    MSSQL_SCHEMA: 'dbo',
    MSSQL_ENCRYPT: 'false',
    MSSQL_TRUST_SERVER_CERTIFICATE: 'true',
    ORACLE_CONNECTION_STRING: `127.0.0.1:${target.port}/XEPDB1`,
    ORACLE_HOST: '127.0.0.1',
    ORACLE_PORT: String(target.port),
    ORACLE_USER: 'enterpriseglue',
    ORACLE_PASSWORD: 'enterpriseglue',
    ORACLE_SERVICE_NAME: 'XEPDB1',
    ORACLE_SCHEMA: 'ENTERPRISEGLUE',
    SPANNER_PROJECT_ID: 'engine-tenancy-local',
    SPANNER_INSTANCE_ID: 'engine-tenancy',
    SPANNER_DATABASE_ID: 'enterpriseglue',
    SPANNER_EMULATOR_HOST: `127.0.0.1:${target.port}`,
  };
  delete environment.DATABASE_URL;
  delete environment.POSTGRES_URL;
  delete environment.ENTERPRISE_SCHEMA;
  delete environment.ENTERPRISE_POSTGRES_SCHEMA;
  return environment;
}

async function qualify(database) {
  const target = contract.databases[database];
  const observationPath = path.join(observationDirectory, `${database}.json`);
  removeContainer(database);
  rmSync(observationPath, { force: true });
  console.log(`[database-matrix] starting ${database} (${target.image})`);
  docker(dockerRunArguments(database));
  try {
    await prepareDatabase(database);
    const result = spawnSync('node', [
      'backend/test/integration/engine-tenancy-database-qualification.mjs',
    ], {
      cwd: root,
      env: workerEnvironment(database, observationPath),
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      const tail = boundedLog(`${result.stdout || ''}\n${result.stderr || ''}`).join('\n');
      throw new Error(`${database} qualification worker failed\n${tail}`);
    }
    return JSON.parse(readFileSync(observationPath, 'utf8'));
  } catch (error) {
    const logs = spawnSync('docker', ['logs', '--tail', '120', containerName(database)], {
      cwd: root,
      encoding: 'utf8',
    });
    const existing = (() => {
      try {
        return JSON.parse(readFileSync(observationPath, 'utf8'));
      } catch {
        return {};
      }
    })();
    return {
      schemaVersion: 1,
      evidenceKind: 'engine-tenancy-database-observation',
      database,
      status: 'failed',
      databaseVersion: existing.databaseVersion || '',
      schemaFingerprint: existing.schemaFingerprint || '',
      stages: existing.stages || Object.fromEntries(
        contract.requiredStages.map((name) => [name, { status: 'not_run' }]),
      ),
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
      diagnostics: {
        containerLogTail: boundedLog(`${logs.stdout || ''}${logs.stderr || ''}`, 80),
      },
      sanitization: {
        containsCredentials: false,
        containsTokens: false,
        containsPrivateEndpoints: false,
        containsRawIdentityClaims: false,
        containsCustomerIdentifiers: false,
      },
    };
  } finally {
    if (!keepContainers) removeContainer(database);
  }
}

mkdirSync(observationDirectory, { recursive: true });
command('corepack', ['pnpm', '--filter', 'shared', 'run', 'build'], { stdio: 'inherit' });
const results = {};
for (const database of selectedDatabases) {
  results[database] = await qualify(database);
}

const endCommit = gitValue(['rev-parse', 'HEAD']);
const endChanges = gitValue(['status', '--porcelain', '--untracked-files=all']);
if (startCommit !== endCommit) {
  throw new Error('Source commit changed while database-matrix evidence was running');
}

const allTargetsExecuted = Object.keys(contract.databases)
  .every((database) => results[database]?.status === 'passed');
const schemaFingerprints = new Set(
  Object.values(results)
    .filter((result) => result.status === 'passed')
    .map((result) => result.schemaFingerprint),
);
const schemaEquivalent = allTargetsExecuted && schemaFingerprints.size === 1;
const sourceState = endChanges ? 'dirty-development-run' : 'clean';
const status = allTargetsExecuted && schemaEquivalent ? 'passed' : 'incomplete';
const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-database-matrix',
  status,
  generatedAt: new Date().toISOString(),
  commit: endCommit,
  sourceState,
  releaseCommitQualified: status === 'passed' && sourceState === 'clean',
  contract: 'test/database/engine-tenancy-database-matrix-contract.json',
  requiredStages: contract.requiredStages,
  upgradeBaselines: contract.upgradeBaselines,
  verifiedTargets: {
    databases: Object.entries(results)
      .filter(([, result]) => result.status === 'passed')
      .map(([database]) => database),
  },
  schemaEquivalence: {
    status: schemaEquivalent ? 'passed' : 'incomplete',
    fingerprintCount: schemaFingerprints.size,
    expectedFingerprintCount: 1,
  },
  results,
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
};
mkdirSync(releaseDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `[database-matrix] ${Object.values(results).filter((result) => result.status === 'passed').length}/` +
  `${Object.keys(contract.databases).length} adapters; schema equivalence ${evidence.schemaEquivalence.status}: ` +
  `${path.relative(root, outputPath)}`,
);
if (status !== 'passed') process.exitCode = 1;
