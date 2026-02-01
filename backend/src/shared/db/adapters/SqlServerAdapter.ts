import { DataSourceOptions } from 'typeorm';
import fs from 'fs';
import { DatabaseAdapter, DatabaseFeature } from './DatabaseAdapter.js';
import { config } from '@shared/config/index.js';
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
        this.getMigrationsPath() + (this.getMigrationsPath().startsWith('dist/') ? '/*.js' : '/*.ts')
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
    return 'src/shared/db/adapters/sql/mssql';
  }

  getMigrationsPath(): string {
    const distPath = 'dist/src/shared/db/migrations';
    if (fs.existsSync(distPath)) return distPath;
    return 'src/shared/db/migrations';
  }
}
