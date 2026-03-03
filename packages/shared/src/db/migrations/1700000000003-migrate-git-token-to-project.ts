import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const GIT_REPOS_TABLE = 'git_repositories';
const GIT_CREDS_TABLE = 'git_credentials';

function quoteIdentifier(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function buildTableRef(schema: string | undefined, name: string): string {
  const normalizedName = String(name)
  const source = normalizedName.includes('.')
    ? normalizedName
    : (schema ? `${schema}.${normalizedName}` : normalizedName)

  return source
    .split('.')
    .filter((part) => part.length > 0)
    .map((part) => quoteIdentifier(part))
    .join('.')
}

function escapeLiteral(value: string): string {
  return String(value).replace(/'/g, "''")
}

/**
 * Migration: Move Git PAT from user-level git_credentials to project-level git_repositories.
 * 
 * Adds new columns to git_repositories and copies the encrypted token from
 * git_credentials (matched via connectedByUserId + providerId).
 */
export class MigrateGitTokenToProject1700000000003 implements MigrationInterface {
  name = 'MigrateGitTokenToProject1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const reposTable = await queryRunner.getTable(GIT_REPOS_TABLE)
    if (!reposTable) {
      console.warn(`Migration ${this.name}: table "${GIT_REPOS_TABLE}" not found; skipping.`);
      return;
    }

    const credsTable = await queryRunner.getTable(GIT_CREDS_TABLE)
    const reposTableRef = buildTableRef(reposTable.schema, reposTable.name)
    const credsTableRef = credsTable ? buildTableRef(credsTable.schema, credsTable.name) : null

    const columnNames = (reposTable.columns || []).map(c => c.name);

    if (!columnNames.includes('encrypted_token')) {
      await queryRunner.addColumns(reposTable, [
        new TableColumn({ name: 'encrypted_token', type: 'text', isNullable: true }),
        new TableColumn({ name: 'last_validated_at', type: 'bigint', isNullable: true }),
        new TableColumn({ name: 'token_scope_hint', type: 'text', isNullable: true }),
        new TableColumn({ name: 'auto_push_enabled', type: 'boolean', isNullable: true }),
        new TableColumn({ name: 'auto_pull_enabled', type: 'boolean', isNullable: true }),
      ]);
    }

    try {
      const repos: Array<{ id: string; connected_by_user_id: string | null; provider_id: string | null }> =
        await queryRunner.query(`SELECT "id", "connected_by_user_id", "provider_id" FROM ${reposTableRef} WHERE "encrypted_token" IS NULL`);

      if (!credsTableRef) {
        console.warn(`Migration ${this.name}: table "${GIT_CREDS_TABLE}" not found; skipping token backfill.`)
        return
      }

      for (const repo of repos) {
        if (!repo.connected_by_user_id || !repo.provider_id) continue;

        const creds: Array<{ access_token: string }> = await queryRunner.query(
          `SELECT "access_token" FROM ${credsTableRef} WHERE "user_id" = '${escapeLiteral(repo.connected_by_user_id)}' AND "provider_id" = '${escapeLiteral(repo.provider_id)}' ORDER BY "updated_at" DESC`
        );

        const token = creds[0]?.access_token;
        if (token) {
          await queryRunner.query(`UPDATE ${reposTableRef} SET "encrypted_token" = '${escapeLiteral(token)}' WHERE "id" = '${escapeLiteral(repo.id)}'`);
        }
      }
    } catch (err) {
      console.warn('Migration: Could not copy tokens from git_credentials (may not exist):', err);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(GIT_REPOS_TABLE))) return;

    const existingColumns = await queryRunner.getTable(GIT_REPOS_TABLE);
    const columnNames = (existingColumns?.columns || []).map(c => c.name);

    const toDrop = ['encrypted_token', 'last_validated_at', 'token_scope_hint', 'auto_push_enabled', 'auto_pull_enabled'];
    for (const col of toDrop) {
      if (columnNames.includes(col)) {
        await queryRunner.dropColumn(GIT_REPOS_TABLE, col);
      }
    }
  }
}
