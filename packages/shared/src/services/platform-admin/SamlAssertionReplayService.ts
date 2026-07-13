import { createHash } from 'node:crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SamlAssertionReplay } from '@enterpriseglue/shared/infrastructure/persistence/entities/SamlAssertionReplay.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { LessThanOrEqual } from 'typeorm';

const DEFAULT_REPLAY_TTL_MS = 10 * 60 * 1000;

export interface ConsumeSamlAssertionInput {
  providerId: string;
  tenantId?: string | null;
  samlResponse: string;
  now?: number;
  ttlMs?: number;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || '');
  if (['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT', 'ORA-00001'].includes(code)) return true;
  return /unique|duplicate/i.test(String(candidate?.message || ''));
}

function normalizeTenantId(tenantId?: string | null): string | null {
  return tenantId?.trim() || null;
}

/** Stores a short-lived hash of a consumed SAML response and rejects replay. */
class SamlAssertionReplayService {
  async consume(input: ConsumeSamlAssertionInput): Promise<void> {
    const providerId = input.providerId.trim();
    if (!providerId) throw Errors.validation('Identity provider id is required');
    if (!input.samlResponse) throw Errors.validation('SAML response is required');

    const now = input.now ?? Date.now();
    const ttlMs = input.ttlMs ?? DEFAULT_REPLAY_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw Errors.validation('SAML replay TTL must be positive');

    const responseHash = createHash('sha256').update(input.samlResponse, 'utf8').digest('hex');
    const repository = (await getDataSource()).getRepository(SamlAssertionReplay);
    await repository.delete({ expiresAt: LessThanOrEqual(now) });

    const existing = await repository.findOne({ where: { providerId, responseHash } });
    if (existing) throw Errors.unauthorized('SAML assertion has already been used');

    try {
      await repository.insert({
        id: generateId(),
        tenantId: normalizeTenantId(input.tenantId),
        providerId,
        responseHash,
        expiresAt: now + ttlMs,
        createdAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw Errors.unauthorized('SAML assertion has already been used');
      throw error;
    }
  }
}

export const samlAssertionReplayService = new SamlAssertionReplayService();
