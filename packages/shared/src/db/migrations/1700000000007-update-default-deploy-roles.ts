import type { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_DEFAULT_DEPLOY_ROLES = '["owner","delegate","operator"]';
const PREVIOUS_DEFAULT_DEPLOY_ROLES = '["owner","delegate","operator","deployer"]';

export class UpdateDefaultDeployRoles1700000000007 implements MigrationInterface {
  name = 'UpdateDefaultDeployRoles1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
      if (!(await queryRunner.hasTable(tablePath))) {
        console.log(`Migration ${this.name}: table "${tablePath}" not found; skipping.`);
        return;
      }

      const rows: Array<Record<string, unknown>> = await queryRunner.query(
        `SELECT "default_deploy_roles" FROM ${tablePath} WHERE "id" = 'default'`
      );

      if (!rows.length) {
        return;
      }

      // Oracle returns uppercase column keys; handle both cases
      const raw = rows[0].default_deploy_roles ?? rows[0].DEFAULT_DEPLOY_ROLES;
      const currentRoles = String(raw || '').trim();
      if (!currentRoles || currentRoles === PREVIOUS_DEFAULT_DEPLOY_ROLES) {
        await queryRunner.query(
          `UPDATE ${tablePath} SET "default_deploy_roles" = '${NEW_DEFAULT_DEPLOY_ROLES}' WHERE "id" = 'default'`
        );
      }
    } catch (err: any) {
      // Gracefully skip if the table doesn't exist yet (e.g. fresh database on Oracle/Postgres)
      console.log(`Migration ${this.name}: skipped (${err?.message || err})`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    try {
      const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
      if (!(await queryRunner.hasTable(tablePath))) {
        return;
      }

      const rows: Array<Record<string, unknown>> = await queryRunner.query(
        `SELECT "default_deploy_roles" FROM ${tablePath} WHERE "id" = 'default'`
      );

      if (!rows.length) {
        return;
      }

      const raw = rows[0].default_deploy_roles ?? rows[0].DEFAULT_DEPLOY_ROLES;
      const currentRoles = String(raw || '').trim();
      if (currentRoles === NEW_DEFAULT_DEPLOY_ROLES) {
        await queryRunner.query(
          `UPDATE ${tablePath} SET "default_deploy_roles" = '${PREVIOUS_DEFAULT_DEPLOY_ROLES}' WHERE "id" = 'default'`
        );
      }
    } catch (err: any) {
      console.log(`Migration ${this.name} (down): skipped (${err?.message || err})`);
    }
  }
}
