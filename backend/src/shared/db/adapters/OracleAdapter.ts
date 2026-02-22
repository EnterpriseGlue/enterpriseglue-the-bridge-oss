import { DataSourceOptions, getMetadataArgsStorage } from 'typeorm';
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
 * Oracle Database Adapter
 * Implements database-specific operations for Oracle
 */
export class OracleAdapter implements DatabaseAdapter {
  private readonly schema: string;
  private readonly logging: boolean;

  constructor() {
    // Oracle schemas are typically uppercase
    this.schema = config.oracleSchema?.toUpperCase() || 'MAIN';
    this.logging = config.nodeEnv === 'development';
    
    // Check if oracledb driver is available
    this.checkDriverAvailability();

    // TypeORM has a stricter supported type set for Oracle.
    // Normalize shared entity metadata to Oracle-safe column types.
    this.normalizeColumnsForOracle();
  }

  private normalizeColumnsForOracle(): void {
    const metadata = getMetadataArgsStorage();
    const indexedColumns = new Set<string>();
    const uniqueConstraintColumns = new Set<string>();

    // Shared entities default to schema "main" for Postgres.
    // Oracle schema must map to the configured Oracle user/schema.
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
      const isPrimaryOrIndexedOrUnique =
        Boolean(column.options.primary) ||
        Boolean(column.options.unique) ||
        indexedColumns.has(key) ||
        uniqueConstraintColumns.has(key);

      if (column.options.type === 'text') {
        column.options.type = 'varchar2';
        if (column.options.length == null) {
          column.options.length = isPrimaryOrIndexedOrUnique ? 191 : 4000;
        }
        continue;
      }

      if (column.options.type === 'boolean') {
        column.options.type = 'number';
        if (column.options.transformer == null) {
          column.options.transformer = {
            to(value: unknown) {
              if (value === null || value === undefined) return value;
              return value ? 1 : 0;
            },
            from(value: unknown) {
              if (value === null || value === undefined) return value;
              return Number(value) === 1;
            },
          };
        }
        continue;
      }

      if (column.options.type === 'bigint') {
        column.options.type = 'number';
        if (column.options.precision == null) {
          column.options.precision = 19;
        }
        if (column.options.scale == null) {
          column.options.scale = 0;
        }
      }
    }
  }

  private getTargetName(target: string | Function): string {
    return typeof target === 'function' ? target.name : String(target);
  }

  private checkDriverAvailability(): void {
    try {
      require.resolve('oracledb');
    } catch {
      console.warn(
        '⚠️  Oracle driver (oracledb) not installed. ' +
        'Install with: npm install oracledb\n' +
        '   Also requires Oracle Instant Client. See: https://oracle.github.io/node-oracledb/INSTALL.html'
      );
    }
  }

  getDataSourceOptions(): DataSourceOptions {
    const connectString = config.oracleServiceName
      ? `${config.oracleHost}:${config.oraclePort}/${config.oracleServiceName}`
      : `${config.oracleHost}:${config.oraclePort}:${config.oracleSid}`;

    return {
      type: 'oracle',
      host: config.oracleHost,
      port: config.oraclePort,
      username: config.oracleUser,
      password: config.oraclePassword,
      serviceName: config.oracleServiceName,
      sid: config.oracleSid,
      schema: this.schema,
      synchronize: false,
      logging: this.logging,
      entities,
      migrations: [
        this.getMigrationsPath() + (this.getMigrationsPath().startsWith('dist/') ? '/*.js' : '/*.ts')
      ],
      extra: {
        // Oracle-specific connection options
        connectString,
      },
    } as DataSourceOptions;
  }

  getSchemaName(): string {
    return this.schema;
  }

  getDatabaseType(): 'postgres' | 'oracle' {
    return 'oracle';
  }

  formatIdentifier(name: string): string {
    // Oracle uses uppercase identifiers by default
    return name.toUpperCase();
  }

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility.
   */
  getCreateSchemaSQL(schemaName: string): string {
    // Oracle creates schemas differently - typically tied to users
    // This creates a user that acts as a schema
    return `
      BEGIN
        EXECUTE IMMEDIATE 'CREATE USER ${schemaName.toUpperCase()} IDENTIFIED BY temp_password DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLCODE = -1920 THEN NULL; -- User already exists
          ELSE RAISE;
          END IF;
      END;
    `;
  }

  supportsFeature(feature: DatabaseFeature): boolean {
    // Oracle feature support
    const supportedFeatures: DatabaseFeature[] = [
      'returning',    // Oracle supports RETURNING INTO
      'sequences',    // Oracle has excellent sequence support
    ];
    
    // Features NOT supported or different in Oracle:
    // - 'ilike': Oracle doesn't have ILIKE, use UPPER() LIKE UPPER()
    // - 'onConflict': Oracle uses MERGE instead
    // - 'jsonb': Oracle has JSON but not JSONB
    // - 'uuid': Oracle doesn't have native UUID, use RAW(16) or VARCHAR2(36)
    
    return supportedFeatures.includes(feature);
  }

  getSqlFilesPath(): string {
    return 'src/shared/db/adapters/sql/oracle';
  }

  getMigrationsPath(): string {
    const distPath = 'dist/shared/db/migrations';
    if (fs.existsSync(distPath)) return distPath;

    const legacyDistPath = 'dist/src/shared/db/migrations';
    if (fs.existsSync(legacyDistPath)) return legacyDistPath;

    return 'src/shared/db/migrations';
  }
}
