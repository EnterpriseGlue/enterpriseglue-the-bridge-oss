import { describe, expect, it, vi } from 'vitest';
import { AddIdentityProvisioningFoundation1700000000111 } from '@enterpriseglue/shared/db/migrations/1700000000111-add-identity-provisioning-foundation.js';

const TABLES = {
  IdentityProvisioningDirectory: 'main.identity_provisioning_directories',
  IdentityProvisioningCredential: 'main.identity_provisioning_credentials',
  ScimUserLink: 'main.scim_user_links',
  ScimGroupLink: 'main.scim_group_links',
  ScimGroupMembership: 'main.scim_group_memberships',
  IdentityProvisioningDiagnostic: 'main.identity_provisioning_diagnostics',
} as const;

describe('identity provisioning persistence foundation', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'creates reversible, idempotent identity provisioning tables on %s',
    async (database) => {
      const created = new Map<string, any>();
      const createTable = vi.fn(async (table: any) => { created.set(table.name, table); });
      const dropTable = vi.fn(async (name: string) => { created.delete(name); });
      const runner = {
        connection: {
          options: { type: database },
          getMetadata: vi.fn((name: keyof typeof TABLES) => ({ tablePath: TABLES[name] })),
        },
        hasTable: vi.fn(async (name: string) => created.has(name)),
        createTable,
        dropTable,
      } as any;

      const migration = new AddIdentityProvisioningFoundation1700000000111();
      await migration.up(runner);
      await migration.up(runner);

      expect(createTable).toHaveBeenCalledTimes(6);
      expect([...created.keys()]).toEqual(Object.values(TABLES));

      const directories = created.get(TABLES.IdentityProvisioningDirectory);
      expect(directories.columns.map((column: any) => column.name)).toContain('active_authoritative_identity');
      expect(directories.uniques.map((unique: any) => unique.name)).toEqual([
        'uq_identity_provisioning_directories_key_identity',
        'uq_identity_provisioning_directories_active_authority',
      ]);
      expect(directories.columns.find((column: any) => column.name === 'directory_key_identity')).toMatchObject({ isNullable: false });
      expect(directories.columns.find((column: any) => column.name === 'credential_secret_ref')).toMatchObject({ isNullable: true });

      const users = created.get(TABLES.ScimUserLink);
      expect(users.uniques.map((unique: any) => unique.name)).toEqual([
        'uq_scim_user_links_directory_user',
        'uq_scim_user_links_directory_username',
        'uq_scim_user_links_external_identity',
      ]);
      expect(users.columns.find((column: any) => column.name === 'external_id_identity')).toMatchObject({ isNullable: false });

      const credentials = created.get(TABLES.IdentityProvisioningCredential);
      expect(credentials.uniques.map((unique: any) => unique.name)).toEqual(['uq_identity_provisioning_credentials_hash']);
      expect(credentials.columns.map((column: any) => column.name)).not.toContain('token');
      expect(directories.columns.map((column: any) => column.name)).not.toContain('credential');

      const memberships = created.get(TABLES.ScimGroupMembership);
      expect(memberships.uniques.map((unique: any) => unique.name)).toEqual(['uq_scim_group_memberships_identity']);

      await migration.down(runner);
      expect(created.size).toBe(0);
      expect(dropTable).toHaveBeenCalledTimes(6);
    },
  );
});
