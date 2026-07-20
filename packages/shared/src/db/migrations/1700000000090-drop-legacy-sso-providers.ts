import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Provider-neutral IdentityProvider rows are the only supported SSO
 * configuration model. No customer legacy provider rows exist to preserve.
 */
export class DropLegacySsoProviders1700000000090 implements MigrationInterface {
  name = 'DropLegacySsoProviders1700000000090';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('sso_providers')) {
      await queryRunner.dropTable('sso_providers', true, true, true);
    }
  }

  async down(): Promise<void> {
    // Deliberately irreversible: legacy provider configuration is retired.
  }
}
