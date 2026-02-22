import type { MigrationInterface, QueryRunner } from 'typeorm';
import { IsNull } from 'typeorm';
import { GitRepository } from '../entities/GitRepository.js';

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
    const gitReposTable = queryRunner.connection.getMetadata('GitRepository').tablePath;
    if (!(await queryRunner.hasTable(gitReposTable))) {
      console.warn(`Migration ${this.name}: table "${gitReposTable}" not found; skipping.`);
      return;
    }

    // Safety check: ensure no git_repositories rows are still missing a token
    const gitRepoRepo = queryRunner.manager.getRepository(GitRepository);
    const count = await gitRepoRepo.count({ where: { encryptedToken: IsNull() } });
    if (count > 0) {
      console.warn(`WARNING: ${count} git_repositories rows still have NULL encrypted_token. Skipping git_credentials drop.`);
      return;
    }

    const gitCredsTable = queryRunner.connection.getMetadata('GitCredential').tablePath;
    if (!(await queryRunner.hasTable(gitCredsTable))) {
      console.warn(`Migration ${this.name}: table "${gitCredsTable}" not found; skipping drop.`);
      return;
    }

    await queryRunner.dropTable(gitCredsTable, true);
    console.log('Dropped git_credentials table.');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally left empty — the table can be recreated by the entity if needed
    console.warn('down(): git_credentials table must be recreated manually if needed.');
  }
}
