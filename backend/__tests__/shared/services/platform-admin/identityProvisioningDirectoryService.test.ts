import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IsNull } from 'typeorm';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningCredential } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningCredential.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import {
  IdentityProvisioningDirectoryService,
  activeAuthoritativeDirectoryIdentity,
  directoryKeyIdentity,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProvisioningDirectoryService.js';

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      return row[key] == null;
    }
    return row[key] === expected;
  });
}

class MemoryRepository<T extends Record<string, any>> {
  constructor(public rows: T[] = []) {}
  create(value: T): T { return value; }
  async insert(value: T): Promise<void> { this.rows.push(value); }
  async findOneBy(where: Partial<T>): Promise<T | null> {
    return this.rows.find((row) => matches(row, where)) ?? null;
  }
  async find(options: { where?: Partial<T>; order?: Record<string, 'ASC' | 'DESC'> } = {}): Promise<T[]> {
    let result = options.where ? this.rows.filter((row) => matches(row, options.where!)) : [...this.rows];
    const orderEntry = Object.entries(options.order ?? {})[0];
    if (orderEntry) {
      const [key, direction] = orderEntry;
      result = [...result].sort((left, right) => String(left[key]).localeCompare(String(right[key])) * (direction === 'DESC' ? -1 : 1));
    }
    return result;
  }
  async save(value: T): Promise<T> {
    const index = this.rows.findIndex((row) => row.id === value.id);
    if (index >= 0) this.rows[index] = value;
    else this.rows.push(value);
    return value;
  }
  async update(where: Partial<T>, changes: Partial<T>): Promise<void> {
    for (const row of this.rows.filter((candidate) => matches(candidate, where))) Object.assign(row, changes);
  }
}

function fixture() {
  const directories = new MemoryRepository<IdentityProvisioningDirectory>();
  const credentials = new MemoryRepository<IdentityProvisioningCredential>();
  const providers = new MemoryRepository<IdentityProvider>();
  const manager = {
    getRepository(entity: unknown) {
      if (entity === IdentityProvisioningDirectory) return directories;
      if (entity === IdentityProvisioningCredential) return credentials;
      if (entity === IdentityProvider) return providers;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    ...manager,
    transaction: vi.fn(async (work: (store: typeof manager) => Promise<unknown>) => work(manager)),
  };
  return {
    directories,
    credentials,
    providers,
    dataSource,
    service: new IdentityProvisioningDirectoryService(async () => dataSource as any),
  };
}

describe('IdentityProvisioningDirectoryService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses stable tenant-scoped identities and a single active-authority identity', () => {
    expect(directoryKeyIdentity(null, ' Workday ')).toBe(directoryKeyIdentity(null, 'workday'));
    expect(directoryKeyIdentity('tenant-a', 'workday')).not.toBe(directoryKeyIdentity('tenant-b', 'workday'));
    expect(activeAuthoritativeDirectoryIdentity('tenant-a', 'a', 'active'))
      .toBe(activeAuthoritativeDirectoryIdentity('tenant-a', 'b', 'active'));
    expect(activeAuthoritativeDirectoryIdentity('tenant-a', 'a', 'disabled'))
      .not.toBe(activeAuthoritativeDirectoryIdentity('tenant-a', 'b', 'disabled'));
  });

  it('creates a disabled authoritative directory and validates an optional sign-in provider', async () => {
    const context = fixture();
    await context.providers.insert({
      id: 'provider-1',
      providerKeyIdentity: 'tenant-a:entra',
    } as IdentityProvider);

    await expect(context.service.create({
      key: 'workday',
      displayName: 'Workday',
      identityProviderKey: 'entra',
      isEnabled: false,
      authoritative: true,
    }, 'tenant-a', 'admin-1')).resolves.toMatchObject({
      key: 'workday',
      status: 'disabled',
      identityProviderKey: 'entra',
      authoritative: true,
      sourceRef: 'user:admin-1',
    });

    await expect(context.service.create({
      key: 'missing',
      displayName: 'Missing provider',
      identityProviderKey: 'does-not-exist',
      isEnabled: false,
      authoritative: true,
    }, 'tenant-a', 'admin-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('uses an explicit null predicate when listing OSS platform directories', async () => {
    const context = fixture();
    const find = vi.spyOn(context.directories, 'find');
    await context.service.list(null);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: expect.any(Object) } }));
    expect(IsNull()).toMatchObject({ _type: 'isNull' });
  });

  it('issues a token once, stores only its hash, and binds verification to an active directory key', async () => {
    const context = fixture();
    await context.directories.insert({
      id: 'directory-1', key: 'workday', status: 'active', tenantId: null,
    } as IdentityProvisioningDirectory);

    const issued = await context.service.issueCredential({ directoryId: 'directory-1', name: 'Primary' });
    expect(issued.token).toMatch(/^egscim_/);
    expect(issued.credential).not.toHaveProperty('tokenHash');
    expect(context.credentials.rows[0]).not.toHaveProperty('token');
    expect(context.credentials.rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);

    await expect(context.service.verifyCredential('workday', issued.token)).resolves.toMatchObject({
      directory: { id: 'directory-1' },
      credential: { id: issued.credential.id },
    });
    await expect(context.service.verifyCredential('wrong-directory', issued.token)).resolves.toBeNull();
    await expect(context.service.verifyCredential('workday', `${issued.token}tampered`)).resolves.toBeNull();

    await context.service.revokeCredential('directory-1', issued.credential.id);
    await expect(context.service.verifyCredential('workday', issued.token)).resolves.toBeNull();
  });

  it('rotates credentials with a bounded overlap and can revoke the old token immediately', async () => {
    const context = fixture();
    await context.directories.insert({ id: 'directory-1', key: 'workday', status: 'active' } as IdentityProvisioningDirectory);
    const original = await context.service.issueCredential({ directoryId: 'directory-1', name: 'Primary' });
    const now = 1_766_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const rotated = await context.service.rotateCredential({
      directoryId: 'directory-1', credentialId: original.credential.id, overlapSeconds: 300,
    });
    expect(rotated.token).not.toBe(original.token);
    expect(context.credentials.rows.find((row) => row.id === original.credential.id)).toMatchObject({
      status: 'overlap', overlapEndsAt: now + 300_000,
    });
    await expect(context.service.verifyCredential('workday', original.token)).resolves.not.toBeNull();
    await expect(context.service.verifyCredential('workday', rotated.token)).resolves.not.toBeNull();

    const immediate = await context.service.rotateCredential({
      directoryId: 'directory-1', credentialId: rotated.credential.id, overlapSeconds: 0,
    });
    await expect(context.service.verifyCredential('workday', rotated.token)).resolves.toBeNull();
    await expect(context.service.verifyCredential('workday', immediate.token)).resolves.not.toBeNull();
  });

  it('archives a directory and revokes every credential in the same transaction', async () => {
    const context = fixture();
    await context.directories.insert({
      id: 'directory-1', key: 'workday', status: 'active', ownershipMode: 'manual',
      directoryKeyIdentity: directoryKeyIdentity(null, 'workday'),
    } as IdentityProvisioningDirectory);
    const issued = await context.service.issueCredential({ directoryId: 'directory-1', name: 'Primary' });

    await context.service.archive('workday', null);
    expect(context.directories.rows[0]).toMatchObject({ status: 'archived', archivedAt: expect.any(Number) });
    expect(context.credentials.rows[0]).toMatchObject({ status: 'revoked', revokedAt: expect.any(Number) });
    await expect(context.service.verifyCredential('workday', issued.token)).resolves.toBeNull();
  });
});
