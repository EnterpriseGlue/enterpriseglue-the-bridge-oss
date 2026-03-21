import { DataSourceOptions } from 'typeorm';
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
 * Google Cloud Spanner Database Adapter
 * Implements database-specific operations for Google Cloud Spanner
 * 
 * Driver: @google-cloud/spanner (npm install @google-cloud/spanner)
 * 
 * Authentication: Set GOOGLE_APPLICATION_CREDENTIALS env var to service account JSON path
 * Emulator: Set SPANNER_EMULATOR_HOST env var for local development
 */
export class SpannerAdapter implements DatabaseAdapter {
  private readonly logging: boolean;

  constructor() {
    this.logging = config.nodeEnv === 'development';
    
    this.checkDriverAvailability();
  }

  private checkDriverAvailability(): void {
    try {
      require.resolve('@google-cloud/spanner');
    } catch {
      console.warn(
        '⚠️  Google Spanner driver (@google-cloud/spanner) not installed. ' +
        'Install with: npm install @google-cloud/spanner\n' +
        '   Also set GOOGLE_APPLICATION_CREDENTIALS env var for authentication.'
      );
    }
  }

  getDataSourceOptions(): DataSourceOptions {
    return {
      type: 'spanner',
      projectId: config.spannerProjectId,
      instanceId: config.spannerInstanceId,
      databaseId: config.spannerDatabaseId,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations: [
        this.getMigrationsPath() + (path.isAbsolute(this.getMigrationsPath()) ? '/*.js' : '/*.ts')
      ],
    } as DataSourceOptions;
  }

  getSchemaName(): string {
    // Spanner doesn't have traditional schemas
    return '';
  }

  getDatabaseType(): 'postgres' | 'oracle' | 'mssql' | 'spanner' {
    return 'spanner';
  }

  formatIdentifier(name: string): string {
    // Spanner is case-sensitive, identifiers should be used as-is
    return name;
  }

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility.
   */
  getCreateSchemaSQL(_schemaName: string): string {
    // Spanner doesn't support schemas in the traditional sense
    // Database structure is defined at the database level
    return '-- Spanner does not use schemas';
  }

  supportsFeature(feature: DatabaseFeature): boolean {
    const supportedFeatures: DatabaseFeature[] = [
      'returning',    // Spanner supports THEN RETURN
    ];
    
    // Features NOT supported or different in Spanner:
    // - 'ilike': Spanner doesn't have ILIKE, use LOWER() or REGEXP_CONTAINS
    // - 'onConflict': Spanner uses INSERT OR UPDATE
    // - 'jsonb': Spanner has JSON type
    // - 'uuid': Spanner doesn't have native UUID, use STRING
    // - 'sequences': Spanner doesn't have sequences, use UUID or bit-reversed sequences
    
    return supportedFeatures.includes(feature);
  }

  getSqlFilesPath(): string {
    const runtimePath = fileURLToPath(import.meta.url);
    const adapterDir = path.dirname(runtimePath);
    const runningFromDist = runtimePath.includes(`${path.sep}dist${path.sep}`);

    if (runningFromDist) {
      return path.join(adapterDir, 'sql', 'spanner');
    }
    return 'packages/shared/src/db/adapters/sql/spanner';
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
