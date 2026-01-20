import { DataSourceOptions } from 'typeorm';
import fs from 'fs';
import { DatabaseAdapter, DatabaseFeature } from './DatabaseAdapter.js';
import { config } from '@shared/config/index.js';
import {
  User, RefreshToken, AuditLog, Notification,
  Project, Folder, File, Version, Comment, ProjectMember, ProjectMemberRole,
  Batch,
  EnvironmentTag, PlatformSettings, EmailTemplate, EmailSendConfig,
  Tenant, TenantSettings, TenantMembership, Invitation,
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
  Tenant, TenantSettings, TenantMembership, Invitation,
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
        this.getMigrationsPath() + (this.getMigrationsPath().startsWith('dist/') ? '/*.js' : '/*.ts')
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
    return 'src/shared/db/adapters/sql/mysql';
  }

  getMigrationsPath(): string {
    const distPath = 'dist/src/shared/db/migrations';
    if (fs.existsSync(distPath)) return distPath;
    return 'src/shared/db/migrations';
  }
}
