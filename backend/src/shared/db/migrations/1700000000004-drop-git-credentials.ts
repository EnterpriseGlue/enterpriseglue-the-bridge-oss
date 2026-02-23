import type { MigrationInterface, QueryRunner } from 'typeorm';

const GIT_REPOS_TABLE = 'git_repositories';
const GIT_CREDS_TABLE = 'git_credentials';

/**
 * Migration: Drop the legacy git_credentials table.
 * 
 * All tokens now live on git_repositories.encrypted_token (project-level).
 * Run this only after confirming all projects have been migrated
 * (i.e. migration 1700000000003 ran and project tokens are populated).
 */
export class DropGitCredentials1700000000004 implements MigrationInterface {
  name = 'DropGitCredentials1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(GIT_REPOS_TABLE))) {
      console.warn(`Migration ${this.name}: table "${GIT_REPOS_TABLE}" not found; skipping.`);
      return;
    }

    const rows: any[] = await queryRunner.query(
      `SELECT COUNT(*) AS "cnt" FROM "${GIT_REPOS_TABLE}" WHERE "encrypted_token" IS NULL`
    );
    const count = Number(rows[0]?.cnt ?? rows[0]?.CNT ?? 0);
    if (count > 0) {
      console.warn(`WARNING: ${count} git_repositories rows still have NULL encrypted_token. Skipping git_credentials drop.`);
      return;
    }

    if (!(await queryRunner.hasTable(GIT_CREDS_TABLE))) {
      console.warn(`Migration ${this.name}: table "${GIT_CREDS_TABLE}" not found; skipping drop.`);
      return;
    }

    await queryRunner.dropTable(GIT_CREDS_TABLE, true);
    console.log('Dropped git_credentials table.');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally left empty — the table can be recreated by the entity if needed
    console.warn('down(): git_credentials table must be recreated manually if needed.');
  }
}
