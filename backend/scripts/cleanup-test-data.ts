#!/usr/bin/env npx tsx
/**
 * Cleanup Test Data Script
 * 
 * Removes leftover test data from the database that was created by integration tests
 * and not properly cleaned up (e.g., due to test failures or interruptions).
 * 
 * Usage: npx tsx scripts/cleanup-test-data.ts
 */

import 'dotenv/config';
import { Pool, PoolClient } from 'pg';

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

function getPool(): Pool {
  return new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? 'postgres',
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    ssl:
      process.env.POSTGRES_SSL === 'true'
        ? {
            rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'true',
          }
        : false,
  });
}

async function selectIds(client: PoolClient, sql: string, params: unknown[]): Promise<string[]> {
  const result = await client.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id);
}

async function cleanupTestData() {
  console.log('🧹 Starting test data cleanup...\n');

  if ((process.env.DATABASE_TYPE ?? 'postgres') !== 'postgres') {
    console.log('Skipping cleanup because DATABASE_TYPE is not postgres.');
    return;
  }

  const schema = quoteIdentifier(process.env.POSTGRES_SCHEMA ?? 'main');
  const pool = getPool();
  const client = await pool.connect();

  const engineNamePatterns = ['test_camunda_%', 'test_%engine%', 'test_%', 'e2e-%'];
  const userEmailPatterns = [
    'e2e-%@example.com',
    'browser-%@example.com',
    'modal-%@example.com',
    'accept-flow-%@example.com',
    'test-%@example.com',
    'test_%@example.com',
    'test_%',
  ];
  const projectNamePatterns = ['test_%', 'e2e-%', 'Smoke %', 'New Project to test Git%'];

  let totalDeleted = 0;

  try {
    await client.query('BEGIN');

    const userIds = await selectIds(
      client,
      `SELECT id FROM ${schema}.users WHERE email LIKE ANY($1::text[])`,
      [userEmailPatterns]
    );

    const projectIds = await selectIds(
      client,
      `SELECT id FROM ${schema}.projects WHERE name LIKE ANY($1::text[])`,
      [projectNamePatterns]
    );

    const engineIds = await selectIds(
      client,
      userIds.length > 0
        ? `SELECT id FROM ${schema}.engines WHERE name LIKE ANY($1::text[]) OR owner_id = ANY($2::text[])`
        : `SELECT id FROM ${schema}.engines WHERE name LIKE ANY($1::text[])`,
      userIds.length > 0 ? [engineNamePatterns, userIds] : [engineNamePatterns]
    );

    console.log(`Found: ${engineIds.length} test engines, ${userIds.length} test users\n`);

    console.log('Cleaning up test refresh tokens and audit logs...');
    if (userIds.length > 0) {
      await client.query(`DELETE FROM ${schema}.refresh_tokens WHERE user_id = ANY($1::text[])`, [userIds]);
      await client.query(`DELETE FROM ${schema}.project_member_roles WHERE user_id = ANY($1::text[])`, [userIds]);
      await client.query(`DELETE FROM ${schema}.project_members WHERE user_id = ANY($1::text[])`, [userIds]);
      await client.query(`DELETE FROM ${schema}.invitations WHERE user_id = ANY($1::text[]) OR email LIKE ANY($2::text[])`, [userIds, userEmailPatterns]);
    }

    await client.query(
      `DELETE FROM ${schema}.audit_logs
       WHERE user_id = ANY($1::text[])
          OR resource_id = ANY($2::text[])
          OR resource_id = ANY($3::text[])
          OR details LIKE $4
          OR details LIKE $5
          OR details LIKE $6
          OR details LIKE $7`,
      [userIds, projectIds, engineIds, '%e2e-%@example.com%', '%test_%@example.com%', '%browser-%@example.com%', '%modal-%@example.com%']
    );

    console.log('Cleaning up test projects...');
    if (projectIds.length > 0) {
      await client.query(`DELETE FROM ${schema}.project_member_roles WHERE project_id = ANY($1::text[])`, [projectIds]);
      await client.query(`DELETE FROM ${schema}.project_members WHERE project_id = ANY($1::text[])`, [projectIds]);
      await client.query(`DELETE FROM ${schema}.files WHERE project_id = ANY($1::text[])`, [projectIds]);
      await client.query(`DELETE FROM ${schema}.folders WHERE project_id = ANY($1::text[])`, [projectIds]);

      const projectDeleteResult = await client.query(`DELETE FROM ${schema}.projects WHERE id = ANY($1::text[])`, [
        projectIds,
      ]);

      const projectCount = Number(projectDeleteResult.rowCount || 0);
      if (projectCount > 0) {
        console.log(`  - Deleted ${projectCount} test projects`);
        totalDeleted += projectCount;
      }
    }

    console.log('Cleaning up test engines...');
    if (engineIds.length > 0) {
      await client.query(`DELETE FROM ${schema}.engine_health WHERE engine_id = ANY($1::text[])`, [engineIds]);
      await client.query(`DELETE FROM ${schema}.engine_members WHERE engine_id = ANY($1::text[])`, [engineIds]);

      const engineDeleteResult = await client.query(`DELETE FROM ${schema}.engines WHERE id = ANY($1::text[])`, [
        engineIds,
      ]);

      const engineCount = Number(engineDeleteResult.rowCount || 0);
      if (engineCount > 0) {
        console.log(`  - Deleted ${engineCount} test engines`);
        totalDeleted += engineCount;
      }
    }

    console.log('Cleaning up test users...');
    if (userIds.length > 0) {
      const userDeleteResult = await client.query(`DELETE FROM ${schema}.users WHERE id = ANY($1::text[])`, [userIds]);

      const userCount = Number(userDeleteResult.rowCount || 0);
      if (userCount > 0) {
        console.log(`  - Deleted ${userCount} test users`);
        totalDeleted += userCount;
      }
    }

    await client.query('COMMIT');
    console.log(`\n✅ Cleanup complete! Removed ${totalDeleted} test records.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupTestData().catch((err) => {
  console.error('❌ Cleanup failed:', err);
  const maybeProcess = (globalThis as any).process;
  if (maybeProcess && typeof maybeProcess.exit === 'function') {
    maybeProcess.exit(1);
  }
});
