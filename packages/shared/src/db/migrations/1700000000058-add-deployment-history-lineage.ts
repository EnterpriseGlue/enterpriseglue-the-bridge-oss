import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn, setExistingColumnNullability, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

const DEPLOYMENT_COLUMNS: Array<{ name: string; type: string; isNullable?: boolean; default?: string }> = [
  { name: 'ingestion_source', type: 'text', default: "'enterpriseglue_proxy'" },
  { name: 'lineage_quality', type: 'text', default: "'complete'" },
  { name: 'reporting_principal_id', type: 'text', isNullable: true },
  { name: 'reconciled_at', type: 'bigint', isNullable: true },
  { name: 'lineage_json', type: 'text', default: "'{}'" },
];

/**
 * The deployment history previously allowed repeated polling/reporting of the
 * same engine deployment.  Keep the newest record before introducing the
 * canonical engine/deployment unique index so upgrades of existing estates do
 * not fail midway through migration.
 */
async function removeDuplicateDeployments(queryRunner: QueryRunner, deployments: string): Promise<void> {
  const column = (name: string) => sqlIdentifier(queryRunner, name);
  const deploymentsRef = sqlTablePath(queryRunner, deployments);
  const rows = await queryRunner.query(
    `SELECT ${column('id')}, ${column('engine_id')}, ${column('camunda_deployment_id')}
     FROM ${deploymentsRef}
     WHERE ${column('camunda_deployment_id')} IS NOT NULL
     ORDER BY ${column('engine_id')} ASC, ${column('camunda_deployment_id')} ASC,`
    + ` ${column('updated_at')} DESC, ${column('created_at')} DESC, ${column('id')} DESC`,
  ) as Array<{ id: string; engine_id: string; camunda_deployment_id: string }>;
  const seenDeployments = new Set<string>();

  for (const row of rows) {
    const key = `${row.engine_id}\u0000${row.camunda_deployment_id}`;
    if (!seenDeployments.has(key)) {
      seenDeployments.add(key);
      continue;
    }
    const idParameter = queryRunner.connection.driver.createParameter('deploymentId', 0);
    await queryRunner.query(`DELETE FROM ${deploymentsRef} WHERE ${column('id')} = ${idParameter}`, [row.id]);
  }
}

/** Makes proxy, pipeline-reported, and later discovered deployment history share one lineage model. */
export class AddDeploymentHistoryLineage1700000000058 implements MigrationInterface {
  name = 'AddDeploymentHistoryLineage1700000000058';

  async up(queryRunner: QueryRunner): Promise<void> {
    const deployments = tablePath(queryRunner, 'EngineDeployment', 'engine_deployments');
    if (await queryRunner.hasTable(deployments)) {
      for (const definition of DEPLOYMENT_COLUMNS) {
        if (!(await queryRunner.hasColumn(deployments, definition.name))) {
          await queryRunner.addColumn(deployments, portableColumn(queryRunner, definition));
        }
      }
      await setExistingColumnNullability(queryRunner, deployments, 'project_id', true);
      const table = await queryRunner.getTable(deployments);
      if (table && !table.indices.some((index) => index.name === 'uq_engine_deployments_engine_camunda_deployment')) {
        await removeDuplicateDeployments(queryRunner, deployments);
        await queryRunner.createIndex(deployments, new TableIndex({
          name: 'uq_engine_deployments_engine_camunda_deployment',
          columnNames: ['engine_id', 'camunda_deployment_id'],
          isUnique: true,
        }));
      }
    }

    const artifacts = tablePath(queryRunner, 'EngineDeploymentArtifact', 'engine_deployment_artifacts');
    if (await queryRunner.hasTable(artifacts)) {
      await setExistingColumnNullability(queryRunner, artifacts, 'project_id', true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const deployments = tablePath(queryRunner, 'EngineDeployment', 'engine_deployments');
    if (await queryRunner.hasTable(deployments)) {
      const table = await queryRunner.getTable(deployments);
      const index = table?.indices.find((candidate) => candidate.name === 'uq_engine_deployments_engine_camunda_deployment');
      if (index) await queryRunner.dropIndex(deployments, index);
      for (const definition of [...DEPLOYMENT_COLUMNS].reverse()) {
        if (await queryRunner.hasColumn(deployments, definition.name)) await queryRunner.dropColumn(deployments, definition.name);
      }
      await setExistingColumnNullability(queryRunner, deployments, 'project_id', false);
    }
    const artifacts = tablePath(queryRunner, 'EngineDeploymentArtifact', 'engine_deployment_artifacts');
    if (await queryRunner.hasTable(artifacts)) {
      await setExistingColumnNullability(queryRunner, artifacts, 'project_id', false);
    }
  }
}
