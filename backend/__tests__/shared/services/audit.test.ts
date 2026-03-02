import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { logAudit, auditFromRequest, auditLog } from '@enterpriseglue/shared/services/audit.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/db/entities/AuditLog.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('audit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs audit entry', async () => {
    const auditRepo = { insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    await logAudit({
      action: 'test.action',
      userId: 'user-1',
      details: { key: 'value' },
    });

    expect(auditRepo.insert).toHaveBeenCalled();
  });

  it('extracts fields from request', () => {
    const req: any = {
      user: { userId: 'user-1' },
      tenant: { tenantId: 'tenant-1' },
      headers: { 'user-agent': 'test-agent' },
      socket: { remoteAddress: '127.0.0.1' },
    };

    const entry = auditFromRequest(req, {
      action: 'test.action',
      resourceType: 'user',
      resourceId: 'user-1',
    });

    expect(entry.userId).toBe('user-1');
    expect(entry.tenantId).toBe('tenant-1');
    expect(entry.action).toBe('test.action');
    expect(entry.resourceType).toBe('user');
  });

  it('handles missing request fields', () => {
    const req: any = {
      headers: {},
      socket: {},
    };

    const entry = auditFromRequest(req, {
      action: 'test.action',
    });

    expect(entry.action).toBe('test.action');
    expect(entry.userId).toBeUndefined();
    expect(entry.tenantId).toBeUndefined();
  });

  it('logs audit from request', async () => {
    const auditRepo = { insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    const req: any = {
      user: { userId: 'user-1' },
      headers: {},
      socket: {},
    };

    await auditLog(req, { action: 'test.action' });

    expect(auditRepo.insert).toHaveBeenCalled();
  });
});
