#!/usr/bin/env npx tsx
/**
 * Cleanup Test Data Script
 * 
 * Removes leftover test data from the database that was created by integration tests
 * and not properly cleaned up (e.g., due to test failures or interruptions).
 * 
 * Usage: npx tsx scripts/cleanup-test-data.ts
 */

import { getDataSource } from '../src/shared/db/data-source.js';

async function cleanupTestData() {
  console.log('🧹 Starting test data cleanup...\n');
  
  const dataSource = await getDataSource();
  
  let totalDeleted = 0;
  
  // First, show counts
  const engineCountResult = await dataSource.query(`
    SELECT COUNT(*) as count FROM main.engines 
    WHERE name LIKE 'test_camunda_%' OR name LIKE 'test_%engine%' OR name LIKE 'test_%'
       OR name LIKE 'e2e-%'
  `);
  const userCountResult = await dataSource.query(`
    SELECT COUNT(*) as count FROM main.users 
    WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'test_%@example.com' OR email LIKE 'test_%'
  `);
  console.log(`Found: ${engineCountResult[0]?.count || 0} test engines, ${userCountResult[0]?.count || 0} test users\n`);
  
  // Clean up test engines (all patterns in one query)
  console.log('Cleaning up test engines...');
  const engineResult = await dataSource.query(`
    DELETE FROM main.engines 
    WHERE name LIKE 'test_camunda_%' 
       OR name LIKE 'test_%engine%'
       OR name LIKE 'test_%'
       OR name LIKE 'e2e-%'
    RETURNING id
  `);
  // TypeORM returns [rows, affectedCount] for some drivers
  const engineCount = Array.isArray(engineResult) ? (engineResult[1] ?? engineResult.length) : 0;
  if (engineCount > 0) {
    console.log(`  - Deleted ${engineCount} test engines`);
    totalDeleted += engineCount;
  }
  
  // Clean up engine health records for deleted engines
  await dataSource.query(`
    DELETE FROM main.engine_health 
    WHERE engine_id NOT IN (SELECT id FROM main.engines)
  `);
  
  // Clean up engine members for deleted engines
  await dataSource.query(`
    DELETE FROM main.engine_members 
    WHERE engine_id NOT IN (SELECT id FROM main.engines)
  `);
  
  // Clean up refresh tokens and audit logs BEFORE deleting users/projects/engines
  // (subqueries reference those tables to find test data)
  console.log('Cleaning up test refresh tokens and audit logs...');
  await dataSource.query(`
    DELETE FROM main.refresh_tokens
    WHERE user_id IN (
      SELECT id FROM main.users
      WHERE email LIKE 'e2e-%@example.com'
         OR email LIKE 'test_%@example.com'
         OR email LIKE 'test_%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.audit_logs
    WHERE user_id IN (
      SELECT id FROM main.users
      WHERE email LIKE 'e2e-%@example.com'
         OR email LIKE 'test_%@example.com'
         OR email LIKE 'test_%'
    )
       OR resource_id IN (
      SELECT id FROM main.projects
      WHERE name LIKE 'test_%'
         OR name LIKE 'e2e-%'
         OR name LIKE 'Smoke %'
         OR name LIKE 'New Project to test Git%'
    )
       OR resource_id IN (
      SELECT id FROM main.engines
      WHERE name LIKE 'test_%' OR name LIKE 'test_camunda_%' OR name LIKE 'e2e-%'
    )
       OR details LIKE '%e2e-%@example.com%'
       OR details LIKE '%test_%@example.com%'
  `);

  // Clean up test projects (before users, since projects reference owner_id)
  console.log('Cleaning up test projects...');
  await dataSource.query(`
    DELETE FROM main.project_member_roles 
    WHERE project_id IN (
      SELECT id FROM main.projects 
      WHERE name LIKE 'test_%'
         OR name LIKE 'e2e-%'
         OR name LIKE 'Smoke %'
         OR name LIKE 'New Project to test Git%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.project_members 
    WHERE project_id IN (
      SELECT id FROM main.projects 
      WHERE name LIKE 'test_%'
         OR name LIKE 'e2e-%'
         OR name LIKE 'Smoke %'
         OR name LIKE 'New Project to test Git%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.files
    WHERE project_id IN (
      SELECT id FROM main.projects
      WHERE name LIKE 'test_%'
         OR name LIKE 'e2e-%'
         OR name LIKE 'Smoke %'
         OR name LIKE 'New Project to test Git%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.folders
    WHERE project_id IN (
      SELECT id FROM main.projects
      WHERE name LIKE 'test_%'
         OR name LIKE 'e2e-%'
         OR name LIKE 'Smoke %'
         OR name LIKE 'New Project to test Git%'
    )
  `);
  const projectResult = await dataSource.query(`
    DELETE FROM main.projects 
    WHERE name LIKE 'test_%'
       OR name LIKE 'e2e-%'
       OR name LIKE 'Smoke %'
       OR name LIKE 'New Project to test Git%'
    RETURNING id
  `);
  const projectCount = Array.isArray(projectResult) ? (projectResult[1] ?? projectResult.length) : 0;
  if (projectCount > 0) {
    console.log(`  - Deleted ${projectCount} test projects`);
    totalDeleted += projectCount;
  }
  
  // Clean up orphaned project members
  await dataSource.query(`
    DELETE FROM main.project_members 
    WHERE project_id NOT IN (SELECT id FROM main.projects)
  `);
  
  // Clean up orphaned engine members
  await dataSource.query(`
    DELETE FROM main.engine_members 
    WHERE engine_id NOT IN (SELECT id FROM main.engines)
  `);

  // Clean up test users (after projects and tokens are removed)
  console.log('Cleaning up test users...');
  const userResult = await dataSource.query(`
    DELETE FROM main.users 
    WHERE email LIKE 'e2e-%@example.com' 
       OR email LIKE 'test_%@example.com'
       OR email LIKE 'test_%'
    RETURNING id
  `);
  const userCount = Array.isArray(userResult) ? (userResult[1] ?? userResult.length) : 0;
  if (userCount > 0) {
    console.log(`  - Deleted ${userCount} test users`);
    totalDeleted += userCount;
  }
  
  console.log(`\n✅ Cleanup complete! Removed ${totalDeleted} test records.`);
  
  await dataSource.destroy();
  process.exit(0);
}

cleanupTestData().catch((err) => {
  console.error('❌ Cleanup failed:', err);
  process.exit(1);
});
