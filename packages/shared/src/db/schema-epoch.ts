import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MigrationExecutor } from 'typeorm';
import type { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { z } from 'zod';

const MigrationInventorySchema = z.object({
  through: z.number().int().nonnegative(),
  count: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const LegacyMigrationInventorySchema = MigrationInventorySchema.extend({
  postgresPolicyProfile: z.literal('legacy-tenant-context/v1'),
}).strict();

const DatabaseEpochSchema = MigrationInventorySchema.extend({
  id: z.enum(['pre-enforcement', 'post-enforcement']),
  postgresPolicyProfile: z.enum([
    'dual-context-compatibility/v1',
    'explicit-context/v1',
  ]),
}).strict();

const ImplementationInventorySchema = z.object({
  algorithm: z.literal('sha256-source-v1'),
  purpose: z.literal('owner-transition-1700000000131-dual-context-closure/v1'),
  count: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const ReleaseEffectInventorySchema = z.object({
  version: z.literal('release-effect-inventory.enterpriseglue.io/v1'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const SchemaEpochManifestSchema = z.object({
  schemaVersion: z.literal('enterpriseglue-schema-epoch/v1'),
  id: z.literal('postgres-explicit-context-bridge-v1'),
  target: z.object({
    databaseType: z.literal('postgres'),
    tenancyMode: z.literal('pooled'),
  }).strict(),
  roles: z.object({
    applicationStartup: z.object({
      mode: z.literal('verify-only'),
    }).strict(),
    preflight: z.object({
      mode: z.literal('verify-runtime-grant'),
    }).strict(),
    ownerMigration: z.object({
      mode: z.literal('apply-through-executable'),
      from: LegacyMigrationInventorySchema,
      through: z.number().int().nonnegative(),
      runtimeGrant: z.literal('configured-role-release-effect-cohorts-select-insert-update/v1'),
    }).strict(),
  }).strict(),
  runtimeCapability: z.literal('postgres-explicit-context/v1'),
  upgradeContract: z.object({
    minimumDatabaseEpoch: LegacyMigrationInventorySchema,
    freshDatabase: z.literal('requires-separate-signed-bootstrap'),
    emptyMigrationLedger: z.literal('requires-separate-signed-recovery'),
  }).strict(),
  executableMigrationInventory: MigrationInventorySchema,
  executableImplementationInventory: ImplementationInventorySchema,
  releaseEffectInventory: ReleaseEffectInventorySchema,
  acceptedDatabaseEpochs: z.tuple([DatabaseEpochSchema, DatabaseEpochSchema]),
}).strict();

export type SchemaEpochManifest = z.infer<typeof SchemaEpochManifestSchema>;
export type AcceptedDatabaseEpoch = SchemaEpochManifest['acceptedDatabaseEpochs'][number];

export interface MigrationIdentity {
  name: string;
  timestamp: number;
}

function migrationIdentity(migration: MigrationInterface | { name?: string; timestamp?: number }): MigrationIdentity {
  const name = typeof migration.name === 'string' && migration.name.length > 0
    ? migration.name
    : migration.constructor.name;
  const timestamp = typeof (migration as { timestamp?: number }).timestamp === 'number'
    ? Number((migration as { timestamp?: number }).timestamp)
    : Number(name.slice(-13));
  if (!/^[A-Za-z][A-Za-z0-9_]*\d{13}$/.test(name) || !Number.isSafeInteger(timestamp)) {
    throw new Error(`Schema-epoch inventory contains invalid migration identity ${name || '<unnamed>'}`);
  }
  return { name, timestamp };
}

export function canonicalMigrationInventory(
  migrations: ReadonlyArray<MigrationInterface | { name?: string; timestamp?: number }>,
  through = Number.MAX_SAFE_INTEGER,
): MigrationIdentity[] {
  return migrations
    .map(migrationIdentity)
    .filter((migration) => migration.timestamp <= through)
    .sort((left, right) => left.timestamp - right.timestamp || left.name.localeCompare(right.name));
}

export function migrationInventorySha256(inventory: readonly MigrationIdentity[]): string {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function assertInventory(
  description: string,
  inventory: readonly MigrationIdentity[],
  expected: z.infer<typeof MigrationInventorySchema>,
): void {
  const last = inventory[inventory.length - 1];
  const digest = migrationInventorySha256(inventory);
  if (inventory.length !== expected.count || last?.timestamp !== expected.through || digest !== expected.sha256) {
    throw new Error(
      `${description} differs from the immutable schema-epoch manifest ` +
      `(through=${last?.timestamp ?? 'none'}, count=${inventory.length}, sha256=${digest})`,
    );
  }
}

export function parseSchemaEpochManifest(value: unknown): SchemaEpochManifest {
  const manifest = SchemaEpochManifestSchema.parse(value);
  const [pre, post] = manifest.acceptedDatabaseEpochs;
  if (
    pre.id !== 'pre-enforcement'
    || pre.postgresPolicyProfile !== 'dual-context-compatibility/v1'
    || post.id !== 'post-enforcement'
    || post.postgresPolicyProfile !== 'explicit-context/v1'
    || manifest.executableMigrationInventory.through !== pre.through
    || manifest.executableMigrationInventory.count !== pre.count
    || manifest.executableMigrationInventory.sha256 !== pre.sha256
    || manifest.roles.ownerMigration.through !== manifest.executableMigrationInventory.through
    || manifest.roles.ownerMigration.from.through + 1 !== manifest.executableMigrationInventory.through
    || manifest.roles.ownerMigration.from.count + 1 !== manifest.executableMigrationInventory.count
    || manifest.upgradeContract.minimumDatabaseEpoch.through !== manifest.roles.ownerMigration.from.through
    || manifest.upgradeContract.minimumDatabaseEpoch.count !== manifest.roles.ownerMigration.from.count
    || manifest.upgradeContract.minimumDatabaseEpoch.sha256 !== manifest.roles.ownerMigration.from.sha256
    || post.through !== pre.through + 1
    || post.count !== pre.count + 1
  ) {
    throw new Error('Schema-epoch manifest does not describe the bounded pre/post enforcement bridge');
  }
  return manifest;
}

export function loadBundledSchemaEpochManifest(): SchemaEpochManifest {
  const manifestUrl = new URL('../schema-epoch-manifest.json', import.meta.url);
  return parseSchemaEpochManifest(JSON.parse(readFileSync(manifestUrl, 'utf8')));
}

export function isSchemaEpochManifestApplicable(
  manifest: SchemaEpochManifest,
  input: { databaseType: string; tenancyMode: string },
): boolean {
  return input.databaseType === manifest.target.databaseType
    && input.tenancyMode === manifest.target.tenancyMode;
}

export function assertSchemaEpochInvocation(
  manifest: SchemaEpochManifest,
  role: 'application-startup' | 'owner-migration' | 'schema-epoch-preflight',
  mode: 'apply' | 'verify',
): void {
  if (role === 'application-startup' && mode !== 'verify') {
    throw new Error(
      `${manifest.id} permits application startup only in verify mode; ` +
      'the separately credentialed owner migration entrypoint owns schema changes',
    );
  }
  if (role === 'owner-migration' && mode !== 'apply') {
    throw new Error(`${manifest.id} permits the owner migration entrypoint only in bounded apply mode`);
  }
  if (role === 'schema-epoch-preflight' && mode !== 'verify') {
    throw new Error(`${manifest.id} permits schema-epoch preflight only in verify mode`);
  }
}

/**
 * Bind this process to the manifest's bounded executable migration inventory.
 *
 * The application and separately credentialed owner job use the same signed
 * bytes. The owner may apply only the executable inventory; application
 * startup can only verify it. The later enforcement migration remains present
 * for post-cutover ledger recognition but is never executable by this bridge.
 */
export function bindDataSourceToSchemaEpoch(
  dataSource: DataSource,
  manifest: SchemaEpochManifest,
): void {
  const registered = canonicalMigrationInventory(dataSource.migrations);
  for (const epoch of manifest.acceptedDatabaseEpochs) {
    assertInventory(
      `Registered migrations through ${epoch.through}`,
      registered.filter((migration) => migration.timestamp <= epoch.through),
      epoch,
    );
  }

  const acceptedMaximum = manifest.acceptedDatabaseEpochs[manifest.acceptedDatabaseEpochs.length - 1].through;
  if (registered.some((migration) => migration.timestamp > acceptedMaximum)) {
    throw new Error('Runtime contains migrations beyond the immutable schema-epoch manifest');
  }

  const executableNames = new Set(
    canonicalMigrationInventory(dataSource.migrations, manifest.executableMigrationInventory.through)
      .map((migration) => migration.name),
  );
  const executableMigrations = dataSource.migrations.filter((migration) =>
    executableNames.has(migrationIdentity(migration).name),
  );
  assertInventory(
    'Executable migration inventory',
    canonicalMigrationInventory(executableMigrations),
    manifest.executableMigrationInventory,
  );
  dataSource.migrations.splice(0, dataSource.migrations.length, ...executableMigrations);
}

export async function verifyExecutedSchemaEpoch(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  manifest: SchemaEpochManifest,
): Promise<AcceptedDatabaseEpoch> {
  const executed = await new MigrationExecutor(dataSource, queryRunner).getExecutedMigrations();
  return resolveAcceptedDatabaseEpoch(manifest, executed);
}

/** Refuse an owner transition unless its starting ledger is the one exact
 * predecessor or an already accepted bridge epoch. This runs before pending
 * migration, synchronize, repair or projection work. */
export async function verifyOwnerMigrationStartingEpoch(
  dataSource: DataSource,
  queryRunner: QueryRunner,
  manifest: SchemaEpochManifest,
): Promise<'owner-source' | AcceptedDatabaseEpoch['id']> {
  const executed = await new MigrationExecutor(dataSource, queryRunner).getExecutedMigrations();
  return resolveOwnerMigrationStartingEpoch(manifest, executed);
}

export function resolveOwnerMigrationStartingEpoch(
  manifest: SchemaEpochManifest,
  executed: ReadonlyArray<MigrationInterface | { name?: string; timestamp?: number }>,
): 'owner-source' | AcceptedDatabaseEpoch['id'] {
  const inventory = canonicalMigrationInventory(executed);
  const digest = migrationInventorySha256(inventory);
  const source = manifest.roles.ownerMigration.from;
  if (
    source.count === inventory.length
    && source.through === inventory[inventory.length - 1]?.timestamp
    && source.sha256 === digest
  ) return 'owner-source';
  const accepted = manifest.acceptedDatabaseEpochs.find((epoch) =>
    epoch.count === inventory.length
    && epoch.through === inventory[inventory.length - 1]?.timestamp
    && epoch.sha256 === digest,
  );
  if (accepted) return accepted.id;
  throw new Error(
    `Owner migration starting epoch is not accepted by ${manifest.id} ` +
    `(through=${inventory[inventory.length - 1]?.timestamp ?? 'none'}, count=${inventory.length}, sha256=${digest})`,
  );
}

export function resolveAcceptedDatabaseEpoch(
  manifest: SchemaEpochManifest,
  executed: ReadonlyArray<MigrationInterface | { name?: string; timestamp?: number }>,
): AcceptedDatabaseEpoch {
  const inventory = canonicalMigrationInventory(executed);
  const digest = migrationInventorySha256(inventory);
  const matched = manifest.acceptedDatabaseEpochs.find((epoch) =>
    epoch.count === inventory.length
    && epoch.through === inventory[inventory.length - 1]?.timestamp
    && epoch.sha256 === digest,
  );
  if (!matched) {
    throw new Error(
      `Database schema epoch is not accepted by ${manifest.id} ` +
      `(through=${inventory[inventory.length - 1]?.timestamp ?? 'none'}, count=${inventory.length}, sha256=${digest})`,
    );
  }
  return matched;
}
