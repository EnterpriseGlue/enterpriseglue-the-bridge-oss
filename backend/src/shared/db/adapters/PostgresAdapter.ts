import { DataSourceOptions } from 'typeorm';
import fs from 'fs';
import { DatabaseAdapter, DatabaseFeature } from './DatabaseAdapter.js';
import { config } from '@shared/config/index.js';
import {
  User, RefreshToken, AuditLog, Notification,
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
  User, RefreshToken, AuditLog, Notification,
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
  }

  getDataSourceOptions(): DataSourceOptions {
    const migrationsPath = this.getMigrationsPath();
    const migrations = config.nodeEnv === 'test'
      ? []
      : [migrationsPath + (migrationsPath.startsWith('dist/') ? '/*.js' : '/*.ts')];

    return {
      type: 'postgres',
      host: config.postgresHost,
      port: config.postgresPort,
      username: config.postgresUser,
      password: config.postgresPassword,
      database: config.postgresDatabase,
      schema: this.schema,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations,
      ssl: config.postgresSsl ? { rejectUnauthorized: false } : undefined,
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
    return 'src/shared/db/adapters/sql/postgres';
  }

  getMigrationsPath(): string {
    const distPath = 'dist/shared/db/migrations';
    if (fs.existsSync(distPath)) return distPath;

    const legacyDistPath = 'dist/src/shared/db/migrations';
    if (fs.existsSync(legacyDistPath)) return legacyDistPath;

    return 'src/shared/db/migrations';
  }
}
