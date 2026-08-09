import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addRequiredColumnWithBackfill,
  sqlIdentifier,
  sqlStringLiteral,
  sqlTablePath,
} from './support/portable-columns.js';
import { canonicalRoleAssignmentKey } from '../../authz/role-assignment-identity.js';

const DEFAULT_TENANT_ID = 'tenant-default';
const LEGACY_DEFAULT_TENANT_ID = 'default-tenant-id';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

function value(row: Record<string, unknown>, name: string): string | null {
  const raw = row[name] ?? row[name.toUpperCase()];
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).trim();
  return normalized || null;
}

function canonicalTenantId(tenantId: string | null): string {
  if (!tenantId || tenantId === LEGACY_DEFAULT_TENANT_ID) return DEFAULT_TENANT_ID;
  return tenantId;
}

async function updateTenant(
  queryRunner: QueryRunner,
  tableName: string,
  id: string,
  tenantId: string,
): Promise<void> {
  const tenantParameter = queryRunner.connection.driver.createParameter('tenantId', 0);
  const idParameter = queryRunner.connection.driver.createParameter('id', 1);
  await queryRunner.query(
    `UPDATE ${sqlTablePath(queryRunner, tableName)} SET ${sqlIdentifier(queryRunner, 'tenant_id')} = ${tenantParameter} `
      + `WHERE ${sqlIdentifier(queryRunner, 'id')} = ${idParameter}`,
    [tenantId, id],
  );
}

async function updateProjectAssignment(
  queryRunner: QueryRunner,
  tableName: string,
  id: string,
  tenantId: string,
  assignmentKey: string,
): Promise<void> {
  const tenantParameter = queryRunner.connection.driver.createParameter('tenantId', 0);
  const keyParameter = queryRunner.connection.driver.createParameter('assignmentKey', 1);
  const idParameter = queryRunner.connection.driver.createParameter('id', 2);
  await queryRunner.query(
    `UPDATE ${sqlTablePath(queryRunner, tableName)} SET ${sqlIdentifier(queryRunner, 'tenant_id')} = ${tenantParameter}, `
      + `${sqlIdentifier(queryRunner, 'assignment_key')} = ${keyParameter} WHERE ${sqlIdentifier(queryRunner, 'id')} = ${idParameter}`,
    [tenantId, assignmentKey, id],
  );
}

async function requireTenantColumn(queryRunner: QueryRunner, tableName: string): Promise<void> {
  const table = await queryRunner.getTable(tableName);
  const current = table?.columns.find((column) => column.name === 'tenant_id');
  if (!current) return;
  const required = current.clone();
  required.isNullable = false;
  required.default = undefined;
  await addRequiredColumnWithBackfill(
    queryRunner,
    tableName,
    required,
    sqlStringLiteral(DEFAULT_TENANT_ID),
  );
}

/**
 * Finalizes the greenfield/default-tenant Project boundary.
 *
 * Historical OSS projects were stored without a tenant. 0.11 classifies
 * those rows into the canonical OSS tenant, derives target ownership from the
 * project, and then makes both database columns required. A conflicting
 * target is rejected before any data is changed.
 */
export class RequireProjectTenantOwnership1700000000109 implements MigrationInterface {
  name = 'RequireProjectTenantOwnership1700000000109';

  async up(queryRunner: QueryRunner): Promise<void> {
    const projectTable = tablePath(queryRunner, 'Project', 'projects');
    const targetTable = tablePath(queryRunner, 'ProjectEngineTarget', 'project_engine_targets');
    const assignmentTable = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const grantTable = tablePath(queryRunner, 'PermissionGrant', 'permission_grants');
    const projects = await queryRunner.getTable(projectTable);
    const targets = await queryRunner.getTable(targetTable);
    if (!projects || !targets) return;
    const assignments = await queryRunner.getTable(assignmentTable);
    const grants = await queryRunner.getTable(grantTable);

    const projectRows = await queryRunner.query(
      `SELECT ${sqlIdentifier(queryRunner, 'id')}, ${sqlIdentifier(queryRunner, 'tenant_id')} `
        + `FROM ${sqlTablePath(queryRunner, projectTable)}`,
    ) as Array<Record<string, unknown>>;
    const targetRows = await queryRunner.query(
      `SELECT ${sqlIdentifier(queryRunner, 'id')}, ${sqlIdentifier(queryRunner, 'project_id')}, ${sqlIdentifier(queryRunner, 'tenant_id')} `
        + `FROM ${sqlTablePath(queryRunner, targetTable)}`,
    ) as Array<Record<string, unknown>>;
    const assignmentRows = assignments
      ? await queryRunner.query(
        `SELECT ${[
          'id', 'tenant_id', 'principal_type', 'principal_id', 'role_id', 'scope_type', 'scope_id', 'source', 'source_ref', 'assignment_key',
        ].map((column) => sqlIdentifier(queryRunner, column)).join(', ')} FROM ${sqlTablePath(queryRunner, assignmentTable)}`,
      ) as Array<Record<string, unknown>>
      : [];
    const grantRows = grants
      ? await queryRunner.query(
        `SELECT ${['id', 'tenant_id', 'resource_type', 'resource_id'].map((column) => sqlIdentifier(queryRunner, column)).join(', ')} `
          + `FROM ${sqlTablePath(queryRunner, grantTable)}`,
      ) as Array<Record<string, unknown>>
      : [];

    const projectTenants = new Map<string, string>();
    for (const row of projectRows) {
      const id = value(row, 'id');
      if (!id) throw new Error('Project tenant migration blocked: a project row has no id.');
      projectTenants.set(id, canonicalTenantId(value(row, 'tenant_id')));
    }

    // Preflight the complete target set before the first update. Existing
    // non-null cross-tenant rows require operator correction, never guessing.
    for (const row of targetRows) {
      const id = value(row, 'id');
      const projectId = value(row, 'project_id');
      const projectTenantId = projectId ? projectTenants.get(projectId) : undefined;
      if (!id || !projectId || !projectTenantId) {
        throw new Error(`Project target tenant migration blocked: target ${JSON.stringify(id || 'unknown')} references a missing project.`);
      }
      const targetTenantId = value(row, 'tenant_id');
      if (targetTenantId && canonicalTenantId(targetTenantId) !== projectTenantId) {
        throw new Error(
          `Project target tenant migration blocked: target ${JSON.stringify(id)} tenant does not match project ${JSON.stringify(projectId)}.`,
        );
      }
    }

    const projectAssignmentUpdates: Array<{ id: string; tenantId: string; assignmentKey: string }> = [];
    const assignmentKeys = new Map<string, string>();
    for (const row of assignmentRows.filter((candidate) => value(candidate, 'scope_type') === 'project')) {
      const id = value(row, 'id');
      const projectId = value(row, 'scope_id');
      const projectTenantId = projectId ? projectTenants.get(projectId) : undefined;
      if (!id || !projectId || !projectTenantId) {
        throw new Error(`Project assignment tenant migration blocked: assignment ${JSON.stringify(id || 'unknown')} references a missing project.`);
      }
      const existingTenantId = value(row, 'tenant_id');
      if (existingTenantId && canonicalTenantId(existingTenantId) !== projectTenantId) {
        throw new Error(`Project assignment tenant migration blocked: assignment ${JSON.stringify(id)} tenant does not match project ${JSON.stringify(projectId)}.`);
      }
      const assignmentKey = canonicalRoleAssignmentKey({
        tenantId: projectTenantId,
        principalType: value(row, 'principal_type') || '',
        principalId: value(row, 'principal_id') || '',
        roleId: value(row, 'role_id') || '',
        scopeType: 'project',
        scopeId: projectId,
        source: value(row, 'source') || '',
        sourceRef: value(row, 'source_ref'),
      });
      const duplicateId = assignmentKeys.get(assignmentKey);
      if (duplicateId && duplicateId !== id) {
        throw new Error(`Project assignment tenant migration blocked: assignments ${JSON.stringify(duplicateId)} and ${JSON.stringify(id)} collide after tenant classification.`);
      }
      assignmentKeys.set(assignmentKey, id);
      projectAssignmentUpdates.push({ id, tenantId: projectTenantId, assignmentKey });
    }

    const projectGrantUpdates: Array<{ id: string; tenantId: string }> = [];
    for (const row of grantRows.filter((candidate) => value(candidate, 'resource_type') === 'project')) {
      const id = value(row, 'id');
      const projectId = value(row, 'resource_id');
      const projectTenantId = projectId ? projectTenants.get(projectId) : undefined;
      if (!id || !projectId || !projectTenantId) {
        throw new Error(`Project permission-grant tenant migration blocked: grant ${JSON.stringify(id || 'unknown')} references a missing project.`);
      }
      const existingTenantId = value(row, 'tenant_id');
      if (existingTenantId && canonicalTenantId(existingTenantId) !== projectTenantId) {
        throw new Error(`Project permission-grant tenant migration blocked: grant ${JSON.stringify(id)} tenant does not match project ${JSON.stringify(projectId)}.`);
      }
      projectGrantUpdates.push({ id, tenantId: projectTenantId });
    }

    for (const row of projectRows) {
      const id = value(row, 'id')!;
      const currentTenantId = value(row, 'tenant_id');
      const tenantId = projectTenants.get(id)!;
      if (currentTenantId !== tenantId) await updateTenant(queryRunner, projectTable, id, tenantId);
    }
    for (const row of targetRows) {
      const id = value(row, 'id')!;
      const projectId = value(row, 'project_id')!;
      const currentTenantId = value(row, 'tenant_id');
      const tenantId = projectTenants.get(projectId)!;
      if (currentTenantId !== tenantId) await updateTenant(queryRunner, targetTable, id, tenantId);
    }
    for (const update of projectAssignmentUpdates) {
      const row = assignmentRows.find((candidate) => value(candidate, 'id') === update.id)!;
      if (value(row, 'tenant_id') !== update.tenantId || value(row, 'assignment_key') !== update.assignmentKey) {
        await updateProjectAssignment(queryRunner, assignmentTable, update.id, update.tenantId, update.assignmentKey);
      }
    }
    for (const update of projectGrantUpdates) {
      const row = grantRows.find((candidate) => value(candidate, 'id') === update.id)!;
      if (value(row, 'tenant_id') !== update.tenantId) {
        await updateTenant(queryRunner, grantTable, update.id, update.tenantId);
      }
    }

    await requireTenantColumn(queryRunner, projectTable);
    await requireTenantColumn(queryRunner, targetTable);
  }

  // This migration is an intentional 0.11 ownership-classification boundary.
  // A full rollback requires restoring the pre-upgrade database and app pair.
  async down(_queryRunner: QueryRunner): Promise<void> {}
}
