import { DataSourceOptions, getMetadataArgsStorage } from 'typeorm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseAdapter, DatabaseFeature } from './DatabaseAdapter.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import {
  User, RefreshToken, PasswordResetToken, AuditLog, Notification,
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
  User, RefreshToken, PasswordResetToken, AuditLog, Notification,
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
 * MySQL/MariaDB Database Adapter
 * Implements database-specific operations for MySQL and MariaDB
 * 
 * Driver: mysql2 (npm install mysql2)
 */
export class MySQLAdapter implements DatabaseAdapter {
  private readonly logging: boolean;

  constructor() {
    this.logging = config.nodeEnv === 'development';
    
    this.checkDriverAvailability();
    this.normalizeColumnsForMySQL();
  }

  private normalizeColumnsForMySQL(): void {
    const metadata = getMetadataArgsStorage();
    const indexedColumns = new Set<string>();
    const uniqueConstraintColumns = new Set<string>();

    for (const unique of metadata.uniques) {
      if (!Array.isArray(unique.columns)) continue;
      const targetName = this.getTargetName(unique.target);
      for (const columnName of unique.columns) {
        if (typeof columnName === 'string') {
          uniqueConstraintColumns.add(`${targetName}:${columnName}`);
        }
      }
    }

    for (const index of metadata.indices) {
      if (!Array.isArray(index.columns)) continue;
      const targetName = this.getTargetName(index.target);
      for (const columnName of index.columns) {
        if (typeof columnName === 'string') {
          indexedColumns.add(`${targetName}:${columnName}`);
        }
      }
    }

    for (const column of metadata.columns) {
      if (column.options.type !== 'text') continue;

      const targetName = this.getTargetName(column.target);
      const key = `${targetName}:${column.propertyName}`;
      const needsVarchar =
        column.options.default != null
        || Boolean(column.options.primary)
        || Boolean(column.options.unique)
        || indexedColumns.has(key)
        || uniqueConstraintColumns.has(key);

      if (!needsVarchar) continue;

      column.options.type = 'varchar';
      if (column.options.length == null) {
        column.options.length = 191;
      }
    }
  }

  private getTargetName(target: string | Function): string {
    return typeof target === 'function' ? target.name : String(target);
  }

  private checkDriverAvailability(): void {
    try {
      require.resolve('mysql2');
    } catch {
      console.warn(
        '⚠️  MySQL driver (mysql2) not installed. ' +
        'Install with: npm install mysql2'
      );
    }
  }

  getDataSourceOptions(): DataSourceOptions {
    return {
      type: 'mysql',
      host: config.mysqlHost,
      port: config.mysqlPort,
      username: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations: [
        this.getMigrationsPath() + (path.isAbsolute(this.getMigrationsPath()) ? '/*.js' : '/*.ts')
      ],
      charset: 'utf8mb4',
    } as DataSourceOptions;
  }

  getSchemaName(): string {
    // MySQL uses database name as schema
    return config.mysqlDatabase || '';
  }

  getDatabaseType(): 'postgres' | 'oracle' | 'mssql' | 'spanner' | 'mysql' {
    return 'mysql';
  }

  formatIdentifier(name: string): string {
    // MySQL uses backticks for identifiers, case-insensitive by default
    return name;
  }

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility.
   */
  getCreateSchemaSQL(schemaName: string): string {
    return `CREATE DATABASE IF NOT EXISTS \`${schemaName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
  }

  supportsFeature(feature: DatabaseFeature): boolean {
    const supportedFeatures: DatabaseFeature[] = [
      'jsonb',        // MySQL 5.7+ has JSON type
    ];
    
    // Features NOT supported or different in MySQL:
    // - 'ilike': MySQL uses LIKE with COLLATE for case-insensitive
    // - 'returning': MySQL 8.0.21+ has limited support, MariaDB 10.5+ has full support
    // - 'onConflict': MySQL uses ON DUPLICATE KEY UPDATE
    // - 'uuid': MySQL doesn't have native UUID, use CHAR(36) or BINARY(16)
    // - 'sequences': MySQL uses AUTO_INCREMENT instead
    
    return supportedFeatures.includes(feature);
  }

  getSqlFilesPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      return path.join(adapterDir, 'sql', 'mysql');
    }
    return 'packages/shared/src/db/adapters/sql/mysql';
  }

  getMigrationsPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      return path.join(adapterDir, '..', 'migrations');
    }
    return 'packages/shared/src/db/migrations';
  }
}
