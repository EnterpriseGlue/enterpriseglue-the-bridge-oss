import { In, IsNull, QueryRunner, TableColumn, TableIndex } from 'typeorm';
import { getDataSource, adapter } from './data-source.js';
import { EnvironmentTag } from './entities/EnvironmentTag.js';
import { PlatformSettings } from './entities/PlatformSettings.js';
import { User } from './entities/User.js';
// Tenant entities removed - multi-tenancy is EE-only
import { EmailTemplate } from './entities/EmailTemplate.js';
import { SsoClaimsMapping } from './entities/SsoClaimsMapping.js';
import { SsoProvider } from './entities/SsoProvider.js';
import { RefreshToken } from './entities/RefreshToken.js';
import { GitProvider } from './entities/GitProvider.js';
import { GitCredential } from './entities/GitCredential.js';
import { File } from './entities/File.js';
import { WorkingFile } from './entities/WorkingFile.js';
import { FileSnapshot } from './entities/FileSnapshot.js';

/**
 * Ensure schema exists using TypeORM QueryRunner APIs (no raw SQL)
 */
async function ensureSchemaExistsWithRunner(queryRunner: QueryRunner, schemaName: string): Promise<void> {
  const hasSchema = await queryRunner.hasSchema(schemaName);
  if (!hasSchema) {
    await queryRunner.createSchema(schemaName, true);
  }
}

export async function ensureSchemaExists(schemaName: string): Promise<void> {
  const dataSource = await getDataSource();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await ensureSchemaExistsWithRunner(queryRunner, schemaName);
  } finally {
    await queryRunner.release();
  }
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

function buildTableRef(schema: string | undefined, name: string): string {
  const normalizedName = String(name);
  const source = normalizedName.includes('.')
    ? normalizedName
    : (schema ? `${schema}.${normalizedName}` : normalizedName);

  return source
    .split('.')
    .filter((part) => part.length > 0)
    .map((part) => quoteIdentifier(part))
    .join('.');
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  const normalized = String(value);
  return normalized.length > 0 ? normalized : null;
}

function buildVersioningIdentityKey(projectId: string, folderId: string | null | undefined, name: string, type: string): string {
  return `${projectId}:${normalizeNullableText(folderId) ?? ''}:${name}:${type}`;
}

function findSchemaObjectConflicts(sourceNames: string[], targetNames: string[]): string[] {
  const targetNameSet = new Set(targetNames);
  return sourceNames.filter((name) => targetNameSet.has(name)).sort((left, right) => left.localeCompare(right));
}

function formatSchemaObjectConflicts(kind: string, names: string[]): string | null {
  if (names.length === 0) {
    return null;
  }
  return `${kind}: ${names.join(', ')}`;
}

async function listSchemaTables(queryRunner: QueryRunner, schemaName: string): Promise<string[]> {
  const rows: Array<{ table_name: string }> = await queryRunner.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
    [schemaName]
  );
  return rows.map((row) => row.table_name);
}

async function listSchemaSequences(queryRunner: QueryRunner, schemaName: string): Promise<string[]> {
  const rows: Array<{ sequence_name: string }> = await queryRunner.query(
    "SELECT c.relname AS sequence_name " +
      "FROM pg_class c " +
      "JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "LEFT JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_class'::regclass " +
      "  AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i') " +
      "LEFT JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r', 'p') " +
      "WHERE c.relkind = 'S' AND n.nspname = $1 AND t.oid IS NULL",
    [schemaName]
  );
  return rows.map((row) => row.sequence_name);
}

async function listSchemaEnums(queryRunner: QueryRunner, schemaName: string): Promise<string[]> {
  const rows: Array<{ type_name: string }> = await queryRunner.query(
    "SELECT t.typname AS type_name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typtype = 'e'",
    [schemaName]
  );
  return rows.map((row) => row.type_name);
}

async function autoMigratePostgresSchema(queryRunner: QueryRunner, schemaName: string): Promise<void> {
  const sourceSchema = 'main';
  const targetSchema = schemaName;

  if (!targetSchema || targetSchema === sourceSchema || targetSchema === 'public') {
    return;
  }

  await ensureSchemaExistsWithRunner(queryRunner, targetSchema);

  const sourceTables = await listSchemaTables(queryRunner, sourceSchema);
  const sourceEnums = await listSchemaEnums(queryRunner, sourceSchema);
  const sourceSequences = await listSchemaSequences(queryRunner, sourceSchema);

  if (sourceTables.length === 0 && sourceEnums.length === 0 && sourceSequences.length === 0) {
    return;
  }

  const targetTables = await listSchemaTables(queryRunner, targetSchema);
  const targetEnums = await listSchemaEnums(queryRunner, targetSchema);
  const targetSequences = await listSchemaSequences(queryRunner, targetSchema);

  const tableConflicts = findSchemaObjectConflicts(sourceTables, targetTables);
  const enumConflicts = findSchemaObjectConflicts(sourceEnums, targetEnums);
  const sequenceConflicts = findSchemaObjectConflicts(sourceSequences, targetSequences);
  const conflictSummary = [
    formatSchemaObjectConflicts('tables', tableConflicts),
    formatSchemaObjectConflicts('enum types', enumConflicts),
    formatSchemaObjectConflicts('sequences', sequenceConflicts),
  ]
    .filter((value): value is string => Boolean(value))
    .join('; ');

  if (conflictSummary) {
    throw new Error(
      `Detected conflicting objects in both "${sourceSchema}" and "${targetSchema}" schemas (${conflictSummary}). ` +
      'Manual cleanup is required before automatic migration can run.'
    );
  }

  if (targetTables.length > 0 || targetEnums.length > 0 || targetSequences.length > 0) {
    console.log(
      `  ℹ️  Detected mixed schema state between "${sourceSchema}" and "${targetSchema}". ` +
        'Moving remaining objects to the configured schema.'
    );
  }

  console.log(
    `  🔁 Migrating ${sourceTables.length} table(s), ${sourceEnums.length} enum type(s), and ${sourceSequences.length} sequence(s) ` +
      `from "${sourceSchema}" to "${targetSchema}"...`
  );

  await queryRunner.startTransaction();
  try {
    for (const typeName of sourceEnums) {
      await queryRunner.query(
        `ALTER TYPE ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(typeName)} SET SCHEMA ${quoteIdentifier(targetSchema)}`
      );
    }

    for (const sequenceName of sourceSequences) {
      await queryRunner.query(
        `ALTER SEQUENCE ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(sequenceName)} SET SCHEMA ${quoteIdentifier(targetSchema)}`
      );
    }

    for (const tableName of sourceTables) {
      await queryRunner.query(
        `ALTER TABLE ${quoteIdentifier(sourceSchema)}.${quoteIdentifier(tableName)} SET SCHEMA ${quoteIdentifier(targetSchema)}`
      );
    }

    await queryRunner.commitTransaction();
    console.log(`  ✅ Schema migration completed to "${targetSchema}".`);
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  }
}

async function ensureCriticalVersioningSchemaIntegrity(queryRunner: QueryRunner): Promise<void> {
  const integrityActions: string[] = [];

  const workingFilesTable = await queryRunner.getTable('working_files');
  const fileSnapshotsTable = await queryRunner.getTable('file_snapshots');

  if (!workingFilesTable || !fileSnapshotsTable) {
    throw new Error('Critical versioning tables are missing after migration startup');
  }

  if (!workingFilesTable.columns.some((column) => column.name === 'main_file_id')) {
    integrityActions.push('added working_files.main_file_id');
    await queryRunner.addColumn(workingFilesTable, new TableColumn({
      name: 'main_file_id',
      type: 'text',
      isNullable: true,
    }));
  }

  if (!fileSnapshotsTable.columns.some((column) => column.name === 'main_file_id')) {
    integrityActions.push('added file_snapshots.main_file_id');
    await queryRunner.addColumn(fileSnapshotsTable, new TableColumn({
      name: 'main_file_id',
      type: 'text',
      isNullable: true,
    }));
  }

  const refreshedWorkingFilesTable = await queryRunner.getTable('working_files');
  const refreshedFileSnapshotsTable = await queryRunner.getTable('file_snapshots');

  if (!refreshedWorkingFilesTable || !refreshedFileSnapshotsTable) {
    throw new Error('Critical versioning tables could not be reloaded after schema repair');
  }

  if (!refreshedWorkingFilesTable.indices.some((index) => index.name === 'working_files_main_file_idx')) {
    integrityActions.push('created working_files_main_file_idx');
    await queryRunner.createIndex(refreshedWorkingFilesTable, new TableIndex({
      name: 'working_files_main_file_idx',
      columnNames: ['main_file_id'],
    }));
  }

  if (!refreshedFileSnapshotsTable.indices.some((index) => index.name === 'file_snapshots_main_file_idx')) {
    integrityActions.push('created file_snapshots_main_file_idx');
    await queryRunner.createIndex(refreshedFileSnapshotsTable, new TableIndex({
      name: 'file_snapshots_main_file_idx',
      columnNames: ['main_file_id'],
    }));
  }

  const manager = queryRunner.manager;
  const fileRepo = manager.getRepository(File);
  const workingFileRepo = manager.getRepository(WorkingFile);
  const fileSnapshotRepo = manager.getRepository(FileSnapshot);

  const workingFilesMissingMainFileId = await workingFileRepo.find({
    where: { mainFileId: IsNull() },
    select: ['id', 'projectId', 'folderId', 'name', 'type'],
  });

  if (workingFilesMissingMainFileId.length > 0) {
    const projectIds = [...new Set(workingFilesMissingMainFileId.map((file) => String(file.projectId)).filter((value) => value.length > 0))];
    const mainFiles = projectIds.length > 0
      ? await fileRepo.find({
          where: { projectId: In(projectIds) },
          select: ['id', 'projectId', 'folderId', 'name', 'type'],
        })
      : [];

    const fileIdByKey = new Map<string, string>();
    for (const mainFile of mainFiles) {
      fileIdByKey.set(
        buildVersioningIdentityKey(String(mainFile.projectId), mainFile.folderId, String(mainFile.name), String(mainFile.type)),
        String(mainFile.id)
      );
    }

    let repairedWorkingFiles = 0;
    for (const workingFile of workingFilesMissingMainFileId) {
      const resolvedMainFileId = fileIdByKey.get(
        buildVersioningIdentityKey(String(workingFile.projectId), workingFile.folderId, String(workingFile.name), String(workingFile.type))
      );
      if (!resolvedMainFileId) {
        continue;
      }

      await workingFileRepo.update({ id: String(workingFile.id) }, { mainFileId: resolvedMainFileId });
      repairedWorkingFiles += 1;
    }

    if (repairedWorkingFiles > 0) {
      integrityActions.push(`backfilled ${repairedWorkingFiles} working_files.main_file_id value(s)`);
    }
  }

  const fileSnapshotsMissingMainFileId = await fileSnapshotRepo.find({
    where: { mainFileId: IsNull() },
    select: ['id', 'workingFileId'],
  });

  if (fileSnapshotsMissingMainFileId.length > 0) {
    const workingFileIds = [...new Set(fileSnapshotsMissingMainFileId.map((snapshot) => String(snapshot.workingFileId)).filter((value) => value.length > 0))];
    const workingFiles = workingFileIds.length > 0
      ? await workingFileRepo.find({
          where: { id: In(workingFileIds) },
          select: ['id', 'mainFileId'],
        })
      : [];

    const mainFileIdByWorkingFileId = new Map<string, string>();
    for (const workingFile of workingFiles) {
      if (!workingFile.mainFileId) {
        continue;
      }
      mainFileIdByWorkingFileId.set(String(workingFile.id), String(workingFile.mainFileId));
    }

    let repairedSnapshots = 0;
    for (const snapshot of fileSnapshotsMissingMainFileId) {
      const resolvedMainFileId = mainFileIdByWorkingFileId.get(String(snapshot.workingFileId));
      if (!resolvedMainFileId) {
        continue;
      }

      await fileSnapshotRepo.update({ id: String(snapshot.id) }, { mainFileId: resolvedMainFileId });
      repairedSnapshots += 1;
    }

    if (repairedSnapshots > 0) {
      integrityActions.push(`backfilled ${repairedSnapshots} file_snapshots.main_file_id value(s)`);
    }
  }

  const verifiedWorkingFilesTable = await queryRunner.getTable('working_files');
  const verifiedFileSnapshotsTable = await queryRunner.getTable('file_snapshots');
  const integrityIssues: string[] = [];

  if (!verifiedWorkingFilesTable?.columns.some((column) => column.name === 'main_file_id')) {
    integrityIssues.push('working_files.main_file_id missing');
  }
  if (!verifiedFileSnapshotsTable?.columns.some((column) => column.name === 'main_file_id')) {
    integrityIssues.push('file_snapshots.main_file_id missing');
  }
  if (!verifiedWorkingFilesTable?.indices.some((index) => index.name === 'working_files_main_file_idx')) {
    integrityIssues.push('working_files_main_file_idx missing');
  }
  if (!verifiedFileSnapshotsTable?.indices.some((index) => index.name === 'file_snapshots_main_file_idx')) {
    integrityIssues.push('file_snapshots_main_file_idx missing');
  }

  if (integrityIssues.length > 0) {
    throw new Error(`Critical versioning schema integrity check failed: ${integrityIssues.join(', ')}`);
  }

  if (integrityActions.length > 0) {
    console.warn(`  ⚠️  Reconciled critical versioning schema drift (${integrityActions.join('; ')})`);
  }
}

/**
 * Run database migrations using TypeORM
 * Database-agnostic implementation supporting PostgreSQL, Oracle, MySQL, SQL Server, Spanner
 */
export async function runMigrations() {
  console.log('🔄 Running database migrations...');
  
  const dbType = adapter.getDatabaseType();
  const schemaName = adapter.getSchemaName();
  
  // Ensure schema exists BEFORE DataSource init (migrations need the schema)
  if (schemaName && schemaName !== 'public') {
    try {
      await ensureSchemaExists(schemaName);
      console.log(`  ✅ Schema "${schemaName}" ensured`);
    } catch (error: any) {
      if (dbType === 'oracle') {
        console.log(`  ℹ️  Oracle schema "${schemaName}" should be created by DBA`);
      } else {
        console.log(`  Note: Schema creation: ${error.message}`);
      }
    }
  }

  try {
    // Initialize TypeORM DataSource (runs pending migrations if any)
    const dataSource = await getDataSource();

    const queryRunner = dataSource.createQueryRunner();
    try {
      if (dbType === 'postgres' && schemaName) {
        try {
          await autoMigratePostgresSchema(queryRunner, schemaName);
        } catch (error) {
          console.error('❌ Schema auto-migration failed. Aborting startup.');
          throw error;
        }
      }

      const coreBootstrapEntities = [
        User,
        SsoProvider,
        RefreshToken,
        EnvironmentTag,
        PlatformSettings,
        EmailTemplate,
        SsoClaimsMapping,
        GitProvider,
        GitCredential,
      ];

      const missingTables: string[] = [];
      for (const entity of coreBootstrapEntities) {
        const tablePath = dataSource.getMetadata(entity).tablePath;
        const hasTable = await queryRunner.hasTable(tablePath);
        if (!hasTable) {
          missingTables.push(tablePath);
        }
      }

      if (missingTables.length > 0) {
        console.log(
          `  ℹ️  Database bootstrap required (missing ${missingTables.length} core table(s): ${missingTables.join(', ')}). Running TypeORM synchronize().`
        );
        await dataSource.synchronize();
      }

    } finally {
      await queryRunner.release();
    }

    // Run pending migrations
    const pendingMigrations = await dataSource.showMigrations();
    if (pendingMigrations) {
      console.log('  Running pending migrations...');
      await dataSource.runMigrations();
    }

    const integrityRunner = dataSource.createQueryRunner();
    try {
      await ensureCriticalVersioningSchemaIntegrity(integrityRunner);
    } finally {
      await integrityRunner.release();
    }
    
    console.log('✅ Database migrations complete');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

/**
 * Seed initial data required for the application
 * Uses TypeORM upsert for database-agnostic seeding
 */
export async function seedInitialData() {
  console.log('🌱 Seeding initial data...');
  
  const dataSource = await getDataSource();
  const now = Date.now();
  
  // Seed default environment tags using TypeORM upsert
  try {
    const envTagRepo = dataSource.getRepository(EnvironmentTag);
    await envTagRepo.upsert([
      { id: 'env-dev', name: 'Dev', color: '#22c55e', manualDeployAllowed: true, sortOrder: 0, isDefault: true, createdAt: now, updatedAt: now },
      { id: 'env-test', name: 'Test', color: '#eab308', manualDeployAllowed: true, sortOrder: 1, isDefault: false, createdAt: now, updatedAt: now },
      { id: 'env-staging', name: 'Staging', color: '#f97316', manualDeployAllowed: false, sortOrder: 2, isDefault: false, createdAt: now, updatedAt: now },
      { id: 'env-production', name: 'Production', color: '#ef4444', manualDeployAllowed: false, sortOrder: 3, isDefault: false, createdAt: now, updatedAt: now },
    ], { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true });
    console.log('  ✅ environment_tags seeded');
  } catch (error: any) {
    console.log('  Note: environment_tags:', error.message);
  }
  
  // Seed default platform settings
  try {
    const platformSettingsRepo = dataSource.getRepository(PlatformSettings);
    await platformSettingsRepo.upsert(
      { id: 'default', updatedAt: now },
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );
    console.log('  ✅ platform_settings seeded');
  } catch (error: any) {
    console.log('  Note: platform_settings:', error.message);
  }
  
  // Tenant seeding removed - multi-tenancy is EE-only
  // OSS runs in single-tenant mode without tenant tables
  console.log('  ℹ️  OSS single-tenant mode (no tenant tables)');
  
  // Seed default email templates
  try {
    const emailTemplateRepo = dataSource.getRepository(EmailTemplate);
    await emailTemplateRepo.upsert([
      {
        id: 'tpl-invite',
        type: 'invite',
        name: 'User Invitation',
        subject: "You've been invited to {{platformName}}",
        htmlTemplate: '<h1>Welcome to {{platformName}}</h1><p>You have been invited by {{inviterName}} to join {{platformName}}.</p><p><a href="{{inviteLink}}">Accept Invitation</a></p><p>This invitation expires in {{expiresIn}}.</p>',
        textTemplate: 'Welcome to {{platformName}}\n\nYou have been invited by {{inviterName}} to join {{platformName}}.\n\nAccept your invitation: {{inviteLink}}\n\nThis invitation expires in {{expiresIn}}.',
        variables: '["platformName", "inviterName", "inviteLink", "expiresIn"]',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-password-reset',
        type: 'password_reset',
        name: 'Password Reset',
        subject: 'Reset your {{platformName}} password',
        htmlTemplate: '<h1>Password Reset Request</h1><p>We received a request to reset your password for {{platformName}}.</p><p><a href="{{resetLink}}">Reset Password</a></p><p>If you didn\'t request this, you can safely ignore this email.</p><p>This link expires in {{expiresIn}}.</p>',
        textTemplate: 'Password Reset Request\n\nWe received a request to reset your password for {{platformName}}.\n\nReset your password: {{resetLink}}\n\nIf you didn\'t request this, you can safely ignore this email.\n\nThis link expires in {{expiresIn}}.',
        variables: '["platformName", "resetLink", "expiresIn"]',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-welcome',
        type: 'welcome',
        name: 'Welcome Email',
        subject: 'Welcome to {{platformName}}!',
        htmlTemplate: '<h1>Welcome to {{platformName}}!</h1><p>Hi {{userName}},</p><p>Your account has been created successfully.</p><p><a href="{{loginLink}}">Login to get started</a></p>',
        textTemplate: 'Welcome to {{platformName}}!\n\nHi {{userName}},\n\nYour account has been created successfully.\n\nLogin to get started: {{loginLink}}',
        variables: '["platformName", "userName", "loginLink"]',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-email-verification',
        type: 'email_verification',
        name: 'Email Verification',
        subject: 'Verify your email for {{platformName}}',
        htmlTemplate: '<h1>Verify Your Email</h1><p>Hi {{userName}},</p><p>Please verify your email address by clicking the link below:</p><p><a href="{{verifyLink}}">Verify Email</a></p><p>This link expires in {{expiresIn}}.</p>',
        textTemplate: 'Verify Your Email\n\nHi {{userName}},\n\nPlease verify your email address: {{verifyLink}}\n\nThis link expires in {{expiresIn}}.',
        variables: '["platformName", "userName", "verifyLink", "expiresIn"]',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ], { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true });
    console.log('  ✅ email_templates seeded');
  } catch (error: any) {
    console.log('  Note: email_templates:', error.message);
  }
  
  // Seed default SSO claims mappings
  try {
    const ssoMappingRepo = dataSource.getRepository(SsoClaimsMapping);
    await ssoMappingRepo.upsert([
      { id: 'default-admin-group', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'Platform Admins', targetRole: 'admin', priority: 100, isActive: true, createdAt: now, updatedAt: now },
      { id: 'default-developer-group', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'Developers', targetRole: 'developer', priority: 50, isActive: true, createdAt: now, updatedAt: now },
      { id: 'default-all-users', providerId: null, claimType: 'group', claimKey: 'groups', claimValue: '*', targetRole: 'user', priority: 0, isActive: true, createdAt: now, updatedAt: now },
    ], { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true });
    console.log('  ✅ sso_claims_mappings seeded');
  } catch (error: any) {
    console.log('  Note: sso_claims_mappings:', error.message);
  }
  
  console.log('✅ Initial data seeding complete');
}

/**
 * Initialize database - run migrations and seed data
 */
export async function initializeDatabase() {
  await runMigrations();
  await seedInitialData();
}
