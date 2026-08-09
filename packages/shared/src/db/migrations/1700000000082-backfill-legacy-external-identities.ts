import type { MigrationInterface, QueryRunner } from 'typeorm';

type LegacyUser = {
  id: string;
  email: string;
  auth_provider: string | null;
  entra_id: string | null;
  google_id: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_login_at: number | null;
};

type ExistingLink = { id: string; user_id: string };

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; }
}

function identityKey(providerId: string, subjectId: string): string {
  return `0:|${providerId.length}:${providerId}|${subjectId.length}:${subjectId}`;
}

function legacyProvider(user: LegacyUser, kind: 'entra' | 'google'): { id: string; type: string } {
  if (kind === 'google') return { id: 'legacy:google', type: 'google' };
  return user.auth_provider === 'saml'
    ? { id: 'legacy:saml', type: 'saml' }
    : { id: 'legacy:microsoft', type: 'microsoft' };
}

/**
 * Mirrors immutable legacy User provider subjects into ExternalIdentity before
 * authentication starts reading provider-neutral links. Existing conflicting
 * links fail closed so a migration can never reassign an external account.
 */
export class BackfillLegacyExternalIdentities1700000000082 implements MigrationInterface {
  name = 'BackfillLegacyExternalIdentities1700000000082';

  async up(queryRunner: QueryRunner): Promise<void> {
    const usersTable = tablePath(queryRunner, 'User', 'users');
    const identitiesTable = tablePath(queryRunner, 'ExternalIdentity', 'external_identities');
    const [users, identities] = await Promise.all([queryRunner.getTable(usersTable), queryRunner.getTable(identitiesTable)]);
    if (!users || !identities) return;
    const requiredUserColumns = ['id', 'email', 'auth_provider', 'entra_id', 'google_id', 'created_at', 'updated_at', 'last_login_at'];
    const requiredIdentityColumns = ['id', 'identity_key', 'tenant_id', 'provider_id', 'provider_type', 'subject_id', 'directory_tenant_id', 'user_id', 'email_hint', 'status', 'linked_at', 'last_seen_at', 'created_at', 'updated_at'];
    if (!requiredUserColumns.every((name) => users.columns.some((column) => column.name === name))
      || !requiredIdentityColumns.every((name) => identities.columns.some((column) => column.name === name))) return;

    const legacyUsers = await queryRunner.query(
      `SELECT id, email, auth_provider, entra_id, google_id, created_at, updated_at, last_login_at FROM ${usersTable} WHERE entra_id IS NOT NULL OR google_id IS NOT NULL`,
    ) as LegacyUser[];
    const now = Date.now();
    for (const user of legacyUsers) {
      const subjects = [
        ...(user.entra_id ? [{ kind: 'entra' as const, subjectId: user.entra_id }] : []),
        ...(user.google_id ? [{ kind: 'google' as const, subjectId: user.google_id }] : []),
      ];
      for (const subject of subjects) {
        const provider = legacyProvider(user, subject.kind);
        const key = identityKey(provider.id, subject.subjectId);
        const keyParameter = queryRunner.connection.driver.createParameter('identityKey', 0);
        const existing = await queryRunner.query(
          `SELECT id, user_id FROM ${identitiesTable} WHERE identity_key = ${keyParameter}`,
          [key],
        ) as ExistingLink[];
        if (existing[0]) {
          if (existing[0].user_id !== user.id) {
            throw new Error(`Legacy external identity ${provider.id}/${subject.subjectId} is already linked to a different user`);
          }
          continue;
        }
        const id = `legacy-external-identity:${provider.id}:${user.id}`;
        const parameters = [id, key, provider.id, provider.type, subject.subjectId, user.id, user.email.toLowerCase(), user.created_at ?? now, user.last_login_at ?? now, user.created_at ?? now, user.updated_at ?? now];
        const parameter = (index: number) => queryRunner.connection.driver.createParameter(`value${index}`, index);
        await queryRunner.query(
          `INSERT INTO ${identitiesTable} (id, identity_key, tenant_id, provider_id, provider_type, subject_id, directory_tenant_id, user_id, email_hint, status, linked_at, last_seen_at, created_at, updated_at) VALUES (${parameter(0)}, ${parameter(1)}, NULL, ${parameter(2)}, ${parameter(3)}, ${parameter(4)}, NULL, ${parameter(5)}, ${parameter(6)}, 'active', ${parameter(7)}, ${parameter(8)}, ${parameter(9)}, ${parameter(10)})`,
          parameters,
        );
      }
    }
  }

  async down(): Promise<void> {
    // This non-destructive account-link backfill is deliberately irreversible.
  }
}
