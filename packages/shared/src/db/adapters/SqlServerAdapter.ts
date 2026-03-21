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
 * Microsoft SQL Server Database Adapter
 * Implements database-specific operations for SQL Server
 * 
 * Driver: mssql (npm install mssql)
 */
export class SqlServerAdapter implements DatabaseAdapter {
  private readonly schema: string;
  private readonly logging: boolean;

  constructor() {
    this.schema = config.mssqlSchema || 'dbo';
    this.logging = config.nodeEnv === 'development';
    
    this.checkDriverAvailability();
    this.normalizeColumnsForSqlServer();
  }

  private normalizeColumnsForSqlServer(): void {
    const metadata = getMetadataArgsStorage();
    const indexedColumns = new Set<string>();
    const uniqueConstraintColumns = new Set<string>();

    for (const table of metadata.tables) {
      const tableSchema = table.schema?.toLowerCase();
      if (!tableSchema || tableSchema === 'main') {
        table.schema = this.schema;
      }
    }

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
      const targetName = this.getTargetName(column.target);
      const key = `${targetName}:${column.propertyName}`;

      if (column.options.type === 'boolean') {
        column.options.type = 'bit';
        continue;
      }

      if (column.options.type !== 'text') continue;

      const needsNvarchar =
        column.options.default != null
        || Boolean(column.options.primary)
        || Boolean(column.options.unique)
        || indexedColumns.has(key)
        || uniqueConstraintColumns.has(key);

      if (!needsNvarchar) continue;

      column.options.type = 'nvarchar';
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
      require.resolve('mssql');
    } catch {
      console.warn(
        '⚠️  SQL Server driver (mssql) not installed. ' +
        'Install with: npm install mssql'
      );
    }
  }

  getDataSourceOptions(): DataSourceOptions {
    return {
      type: 'mssql',
      host: config.mssqlHost,
      port: config.mssqlPort,
      username: config.mssqlUser,
      password: config.mssqlPassword,
      database: config.mssqlDatabase,
      schema: this.schema,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations: [
        this.getMigrationsPath() + (path.isAbsolute(this.getMigrationsPath()) ? '/*.js' : '/*.ts')
      ],
      options: {
        encrypt: config.mssqlEncrypt,
        trustServerCertificate: config.mssqlTrustServerCertificate,
      },
    } as DataSourceOptions;
  }

  getSchemaName(): string {
    return this.schema;
  }

  getDatabaseType(): 'postgres' | 'oracle' | 'mssql' | 'spanner' {
    return 'mssql';
  }

  formatIdentifier(name: string): string {
    // SQL Server uses square brackets for identifiers, case-insensitive by default
    return name;
  }

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility.
   */
  getCreateSchemaSQL(schemaName: string): string {
    return `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}') EXEC('CREATE SCHEMA [${schemaName}]')`;
  }

  supportsFeature(feature: DatabaseFeature): boolean {
    const supportedFeatures: DatabaseFeature[] = [
      'returning',    // SQL Server supports OUTPUT clause (similar to RETURNING)
      'sequences',    // SQL Server 2012+ supports sequences
      'uuid',         // SQL Server has UNIQUEIDENTIFIER
    ];
    
    // Features NOT supported or different in SQL Server:
    // - 'ilike': SQL Server uses COLLATE for case-insensitive, or LIKE with proper collation
    // - 'onConflict': SQL Server uses MERGE instead
    // - 'jsonb': SQL Server has JSON functions but no JSONB type
    
    return supportedFeatures.includes(feature);
  }

  getSqlFilesPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      return path.join(adapterDir, 'sql', 'mssql');
    }
    return 'packages/shared/src/db/adapters/sql/mssql';
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
