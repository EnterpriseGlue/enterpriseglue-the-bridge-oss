import { DataSourceOptions, getMetadataArgsStorage } from 'typeorm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseAdapter, DatabaseFeature } from './DatabaseAdapter.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import {
  User, RefreshToken, PasswordResetToken, Invitation, AuditLog, Notification,
  Project, Folder, File, Version, Comment, ProjectMember, ProjectMemberRole,
  Batch,
  EnvironmentTag, PlatformSettings, EmailTemplate, EmailSendConfig,
  // Tenant entities removed - multi-tenancy is EE-only
  EngineMember, EngineProjectAccess, EngineAccessRequest, PermissionGrant,
  GitProvider, SsoProvider, SsoClaimsMapping, AuthzPolicy, AuthzAuditLog,
  Branch, Commit, WorkingFile, FileSnapshot, FileCommitVersion, WorkingFolder, RemoteSyncState, PendingChange,
  Engine, SavedFilter, EngineHealth,
  GitRepository, GitCredential, GitLock, GitDeployment, GitTag, GitPushQueue, GitAuditLog,
  EngineDeployment, EngineDeploymentArtifact,
} from '../entities/index.js';

const entities = [
  User, RefreshToken, PasswordResetToken, Invitation, AuditLog, Notification,
  Project, Folder, File, Version, Comment, ProjectMember, ProjectMemberRole,
  Batch,
  EnvironmentTag, PlatformSettings, EmailTemplate, EmailSendConfig,
  // Tenant entities removed - multi-tenancy is EE-only
  EngineMember, EngineProjectAccess, EngineAccessRequest, PermissionGrant,
  GitProvider, SsoProvider, SsoClaimsMapping, AuthzPolicy, AuthzAuditLog,
  Branch, Commit, WorkingFile, FileSnapshot, FileCommitVersion, WorkingFolder, RemoteSyncState, PendingChange,
  Engine, SavedFilter, EngineHealth,
  GitRepository, GitCredential, GitLock, GitDeployment, GitTag, GitPushQueue, GitAuditLog,
  EngineDeployment, EngineDeploymentArtifact,
];

/**
 * PostgreSQL Database Adapter
 * Implements database-specific operations for PostgreSQL
 */
export class PostgresAdapter implements DatabaseAdapter {
  private readonly schema: string;
  private readonly logging: boolean;

  constructor() {
    this.schema = config.postgresSchema;
    this.logging = config.nodeEnv === 'development';

    this.normalizeSchemaForPostgres();
  }

  private normalizeSchemaForPostgres(): void {
    const metadata = getMetadataArgsStorage();
    const targetSchema = this.schema;

    for (const table of metadata.tables) {
      const tableSchema = table.schema?.toLowerCase();
      if (!tableSchema || tableSchema === 'main') {
        table.schema = targetSchema;
      }
    }
  }

  getDataSourceOptions(): DataSourceOptions {
    const migrationsPath = this.getMigrationsPath();
    const migrations = config.nodeEnv === 'test'
      ? []
      : [migrationsPath + (path.isAbsolute(migrationsPath) ? '/*.js' : '/*.ts')];

    const base = {
      type: 'postgres' as const,
      schema: this.schema,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations,
      ssl: config.postgresSsl ? { rejectUnauthorized: config.postgresSslRejectUnauthorized } : undefined,
    };

    if (config.postgresUrl) {
      return { ...base, url: config.postgresUrl };
    }

    return {
      ...base,
      host: config.postgresHost,
      port: config.postgresPort,
      username: config.postgresUser,
      password: config.postgresPassword,
      database: config.postgresDatabase,
    };
  }

  getSchemaName(): string {
    return this.schema;
  }

  getDatabaseType(): 'postgres' | 'oracle' {
    return 'postgres';
  }

  formatIdentifier(name: string): string {
    // PostgreSQL uses lowercase identifiers by default
    return name.toLowerCase();
  }

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility.
   */
  getCreateSchemaSQL(schemaName: string): string {
    return `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`;
  }

  supportsFeature(feature: DatabaseFeature): boolean {
    // PostgreSQL supports all features
    const supportedFeatures: DatabaseFeature[] = [
      'ilike',
      'returning',
      'onConflict',
      'jsonb',
      'uuid',
      'sequences',
    ];
    return supportedFeatures.includes(feature);
  }

  getSqlFilesPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      return path.join(adapterDir, 'sql', 'postgres');
    }
    return 'packages/shared/src/db/adapters/sql/postgres';
  }

  private findWorktreeDistPath(pathSegments: string[]): string | null {
    const searchRoots = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];

    for (const root of searchRoots) {
      let current = root;
      while (true) {
        const candidate = path.join(current, ...pathSegments);
        if (fs.existsSync(candidate)) {
          return candidate;
        }

        const parent = path.dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    }

    return null;
  }

  getMigrationsPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      const sharedDistMigrations = this.findWorktreeDistPath(['packages', 'shared', 'dist', 'db', 'migrations']);
      if (sharedDistMigrations) {
        return sharedDistMigrations;
      }
      return path.join(adapterDir, '..', 'migrations');
    }
    return 'packages/shared/src/db/migrations';
  }
}
