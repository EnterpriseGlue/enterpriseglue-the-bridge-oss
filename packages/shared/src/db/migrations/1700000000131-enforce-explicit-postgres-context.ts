import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyPostgresTenantPolicies } from '../postgres-tenant-policy.js';

/** Upgrade requires draining/replacing every older shared-schema consumer. */
export class EnforceExplicitPostgresContext1700000000131 implements MigrationInterface {
  name = 'EnforceExplicitPostgresContext1700000000131';

  async up(queryRunner: QueryRunner): Promise<void> {
    await applyPostgresTenantPolicies(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    throw new Error('Explicit PostgreSQL security context enforcement cannot be downgraded in place');
  }
}
