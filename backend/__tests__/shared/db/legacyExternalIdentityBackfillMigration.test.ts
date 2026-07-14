import { describe, expect, it, vi } from 'vitest';
import { BackfillLegacyExternalIdentities1700000000082 } from '@enterpriseglue/shared/db/migrations/1700000000082-backfill-legacy-external-identities.js';

const userColumns = ['id', 'email', 'auth_provider', 'entra_id', 'google_id', 'created_at', 'updated_at', 'last_login_at'].map((name) => ({ name }));
const identityColumns = ['id', 'identity_key', 'tenant_id', 'provider_id', 'provider_type', 'subject_id', 'directory_tenant_id', 'user_id', 'email_hint', 'status', 'linked_at', 'last_seen_at', 'created_at', 'updated_at'].map((name) => ({ name }));

describe('BackfillLegacyExternalIdentities1700000000082', () => {
  it('mirrors provider-specific subjects and keeps their legacy provider domains distinct', async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.startsWith('SELECT id, email')) return [
        { id: 'user-microsoft', email: 'Microsoft@Example.test', auth_provider: 'microsoft', entra_id: 'entra-1', google_id: null, created_at: 10, updated_at: 20, last_login_at: 30 },
        { id: 'user-saml', email: 'saml@example.test', auth_provider: 'saml', entra_id: 'entra-1', google_id: null, created_at: 11, updated_at: 21, last_login_at: null },
        { id: 'user-google', email: 'google@example.test', auth_provider: 'google', entra_id: null, google_id: 'google-1', created_at: 12, updated_at: 22, last_login_at: 32 },
      ];
      if (sql.startsWith('SELECT id, user_id')) return [];
      return undefined;
    });
    const queryRunner = {
      getTable: vi.fn()
        .mockResolvedValueOnce({ columns: userColumns })
        .mockResolvedValueOnce({ columns: identityColumns }),
      query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new BackfillLegacyExternalIdentities1700000000082().up(queryRunner as any);

    const inserts = query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO external_identities'));
    expect(inserts).toHaveLength(3);
    expect(inserts.map(([, parameters]) => parameters)).toEqual(expect.arrayContaining([
      expect.arrayContaining(['legacy:microsoft', 'microsoft', 'entra-1', 'user-microsoft', 'microsoft@example.test']),
      expect.arrayContaining(['legacy:saml', 'saml', 'entra-1', 'user-saml', 'saml@example.test']),
      expect.arrayContaining(['legacy:google', 'google', 'google-1', 'user-google', 'google@example.test']),
    ]));
  });

  it('fails closed rather than reassigning a subject linked to another user', async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.startsWith('SELECT id, email')) return [{ id: 'user-1', email: 'person@example.test', auth_provider: 'microsoft', entra_id: 'entra-1', google_id: null, created_at: 1, updated_at: 1, last_login_at: 1 }];
      if (sql.startsWith('SELECT id, user_id')) return [{ id: 'existing-link', user_id: 'user-2' }];
      return undefined;
    });
    const queryRunner = {
      getTable: vi.fn()
        .mockResolvedValueOnce({ columns: userColumns })
        .mockResolvedValueOnce({ columns: identityColumns }),
      query,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); }, driver: { createParameter: (_name: string, index: number) => `$${index + 1}` } },
    };

    await expect(new BackfillLegacyExternalIdentities1700000000082().up(queryRunner as any))
      .rejects.toThrow('already linked to a different user');
  });
});
