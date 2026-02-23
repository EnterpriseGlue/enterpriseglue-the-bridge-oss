import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Originally dropped the git_credentials table.
 * 
 * Now a NO-OP because the GitCredential entity and CredentialService are
 * still actively used for user-level credential management. On fresh
 * deployments the old safety check (count of NULL encrypted_token in
 * git_repositories) incorrectly evaluated to 0 rows and dropped the table.
 */
export class DropGitCredentials1700000000004 implements MigrationInterface {
  name = 'DropGitCredentials1700000000004';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // NO-OP: The GitCredential entity and CredentialService are still actively
    // used for user-level credential management. Dropping the table breaks the
    // admin providers endpoint (and any credential CRUD) on fresh deployments
    // where git_repositories has zero rows, causing the old safety check to
    // incorrectly allow the drop.
    console.log(`Migration ${this.name}: skipped (git_credentials table is still in active use).`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally left empty — the table can be recreated by the entity if needed
    console.warn('down(): git_credentials table must be recreated manually if needed.');
  }
}
