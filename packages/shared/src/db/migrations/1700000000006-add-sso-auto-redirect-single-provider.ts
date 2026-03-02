import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSsoAutoRedirectSingleProvider1700000000006 implements MigrationInterface {
  name = 'AddSsoAutoRedirectSingleProvider1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      console.warn(`Migration ${this.name}: table "${tablePath}" not found; skipping.`);
      return;
    }
    const column = new TableColumn({
      name: 'sso_auto_redirect_single_provider',
      type: 'boolean',
      default: false,
    });

    const exists = await queryRunner.hasColumn(tablePath, column.name);
    if (!exists) {
      await queryRunner.addColumn(tablePath, column);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }
    const exists = await queryRunner.hasColumn(tablePath, 'sso_auto_redirect_single_provider');
    if (exists) {
      await queryRunner.dropColumn(tablePath, 'sso_auto_redirect_single_provider');
    }
  }
}
