import type { MigrationInterface, QueryRunner } from 'typeorm';

import {
  applyDualContextPostgresTenantPolicies,
  applyLegacyPostgresTenantPolicies,
} from '../postgres-tenant-policy.js';
import {
  assertReleaseEffectCohortTableShape,
  expectedReleaseEffectCohortTable,
} from '../release-effect-cohort-schema.js';

export class AddReleaseEffectCohorts1700000000131 implements MigrationInterface {
  name = 'AddReleaseEffectCohorts1700000000131';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('ReleaseEffectCohort').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      throw new Error('Schema-epoch owner transition refuses a pre-existing release_effect_cohorts relation');
    }
    const expectedTable = expectedReleaseEffectCohortTable(queryRunner, tablePath);
    await queryRunner.createTable(expectedTable, true);
    await assertReleaseEffectCohortTableShape(
      queryRunner,
      expectedReleaseEffectCohortTable(queryRunner, tablePath),
    );
    await applyDualContextPostgresTenantPolicies(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await applyLegacyPostgresTenantPolicies(queryRunner);
    const tablePath = queryRunner.connection.getMetadata('ReleaseEffectCohort').tablePath;
    if (await queryRunner.hasTable(tablePath)) await queryRunner.dropTable(tablePath);
  }
}
