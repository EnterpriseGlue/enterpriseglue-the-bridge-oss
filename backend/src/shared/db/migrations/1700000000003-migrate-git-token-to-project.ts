import { TableColumn, IsNull } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { GitRepository } from '../entities/GitRepository.js';
import { GitCredential } from '../entities/GitCredential.js';

/**
 * Migration: Move Git PAT from user-level git_credentials to project-level git_repositories.
 * 
 * Adds new columns to git_repositories and copies the encrypted token from
 * git_credentials (matched via connectedByUserId + providerId).
 */
export class MigrateGitTokenToProject1700000000003 implements MigrationInterface {
  name = 'MigrateGitTokenToProject1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const gitReposTable = queryRunner.connection.getMetadata('GitRepository').tablePath;

    // 1. Add new columns to git_repositories
    const existingColumns = await queryRunner.getTable(gitReposTable);
    const columnNames = (existingColumns?.columns || []).map(c => c.name);

    if (!columnNames.includes('encrypted_token')) {
      await queryRunner.addColumns(gitReposTable, [
        new TableColumn({ name: 'encrypted_token', type: 'text', isNullable: true }),
        new TableColumn({ name: 'last_validated_at', type: 'bigint', isNullable: true }),
        new TableColumn({ name: 'token_scope_hint', type: 'text', isNullable: true }),
        new TableColumn({ name: 'auto_push_enabled', type: 'boolean', isNullable: true }),
        new TableColumn({ name: 'auto_pull_enabled', type: 'boolean', isNullable: true }),
      ]);
    }

    // 2. Copy encrypted tokens from git_credentials to git_repositories
    // Match by connectedByUserId + providerId
    const gitRepoRepo = queryRunner.manager.getRepository(GitRepository);
    const gitCredRepo = queryRunner.manager.getRepository(GitCredential);

    try {
      const repos = await gitRepoRepo.find({
        where: { encryptedToken: IsNull() },
        select: ['id', 'connectedByUserId', 'providerId'],
      });

      for (const repo of repos) {
        if (!repo.connectedByUserId || !repo.providerId) continue;

        const creds = await gitCredRepo.findOne({
          where: {
            userId: repo.connectedByUserId,
            providerId: repo.providerId,
          },
          select: ['accessToken'],
          order: { updatedAt: 'DESC' },
        });

        if (creds?.accessToken) {
          await gitRepoRepo.update({ id: repo.id }, { encryptedToken: creds.accessToken });
        }
      }
    } catch (err) {
      // git_credentials table may not exist yet in fresh installs — that's fine
      console.warn('Migration: Could not copy tokens from git_credentials (may not exist):', err);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const gitReposTable = queryRunner.connection.getMetadata('GitRepository').tablePath;

    const existingColumns = await queryRunner.getTable(gitReposTable);
    const columnNames = (existingColumns?.columns || []).map(c => c.name);

    const toDrop = ['encrypted_token', 'last_validated_at', 'token_scope_hint', 'auto_push_enabled', 'auto_pull_enabled'];
    for (const col of toDrop) {
      if (columnNames.includes(col)) {
        await queryRunner.dropColumn(gitReposTable, col);
      }
    }
  }
}
