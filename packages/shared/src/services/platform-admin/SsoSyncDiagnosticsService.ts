import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { SsoSyncEvent } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoSyncEvent.js';
import { SsoSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoSyncRun.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { IsNull } from 'typeorm';
import { IdentityProviderFailure } from './IdentityProviderFailure.js';
import { ssoProviderIdentityCheckService } from './SsoProviderIdentityCheckService.js';

export type SsoSyncRunStatus = 'running' | 'success' | 'failed';
export type SsoSyncTrigger = 'login' | 'scheduled' | 'manual' | 'mapping_change' | 'engine_change';

export interface SsoSyncCounts {
  groupMembershipsCreated?: number;
  groupMembershipsUpdated?: number;
  groupMembershipsRemoved?: number;
  assignmentsCreated?: number;
  assignmentsUpdated?: number;
  assignmentsRemoved?: number;
}

export interface StartSsoSyncRunInput {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  trigger: SsoSyncTrigger;
  correlationId?: string | null;
  details?: Record<string, unknown>;
}

export interface CompleteSsoSyncRunInput extends SsoSyncCounts {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  correlationId?: string | null;
  details?: Record<string, unknown>;
}

export interface SsoSyncRunView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  userId: string | null;
  trigger: SsoSyncTrigger;
  status: SsoSyncRunStatus;
  startedAt: number;
  completedAt: number | null;
  groupMembershipsCreated: number;
  groupMembershipsUpdated: number;
  groupMembershipsRemoved: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
  details: string;
}

export interface SsoSyncEventView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  runId: string;
  severity: 'info' | 'warning' | 'error';
  type: string;
  userId: string | null;
  mappingType: string | null;
  mappingId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  message: string;
  details: string;
  createdAt: number;
}

export interface ListSsoSyncRunsInput {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  status?: SsoSyncRunStatus;
  trigger?: SsoSyncTrigger;
  limit?: number;
}

export interface ListSsoSyncEventsInput {
  tenantId?: string | null;
  providerId?: string | null;
  runId: string;
  severity?: 'info' | 'warning' | 'error';
  limit?: number;
}

export interface RunSsoProviderIdentityCheckInput {
  tenantId?: string | null;
  providerId?: string | null;
  trigger?: Extract<SsoSyncTrigger, 'scheduled' | 'manual' | 'mapping_change' | 'engine_change'>;
  details?: Record<string, unknown>;
  limit?: number;
}

export interface SsoProviderIdentityCheckRunResult {
  runId: string | null;
  scannedIdentities: number;
  checkedIdentities: number;
  unsupportedIdentities: number;
  activeIdentities: number;
  inactiveIdentities: number;
  deletedIdentities: number;
  unknownIdentities: number;
  failedIdentities: number;
}

function normalizeTenantId(tenantId?: string | null): string | null {
  return tenantId?.trim() || null;
}

function normalizeProviderId(providerId?: string | null): string | null {
  return providerId?.trim() || null;
}

const sensitiveDiagnosticKey = /(?:access[_-]?token|id[_-]?token|refresh[_-]?token|token|assertion|password|secret|certificate|private[_-]?key|authorization|cookie)/i;

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted certificate]')
    .replace(/<\/?(?:\w+:)?(?:Assertion|Response)\b[^>]*>[\s\S]*?<\/?(?:\w+:)?(?:Assertion|Response)>/gi, '[redacted assertion]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:access[_-]?token|id[_-]?token|refresh[_-]?token|token|password|secret|assertion|authorization)=([^\s,&]+)/gi, (matched) => `${matched.slice(0, matched.indexOf('=') + 1)}[redacted]`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]');
}

function sanitizeDiagnosticValue(value: unknown, key?: string): unknown {
  if (key && sensitiveDiagnosticKey.test(key)) return '[redacted]';
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeDiagnosticValue(entryValue, entryKey)]));
  }
  return value;
}

function stringifyDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '{}';
  try { return JSON.stringify(sanitizeDiagnosticValue(details)); } catch { return '{}'; }
}

function withCorrelation(details: Record<string, unknown> | undefined, correlationId: string | null | undefined): Record<string, unknown> | undefined {
  const normalized = correlationId?.trim();
  return normalized ? { ...details, correlationId: normalized } : details;
}

let diagnosticNow = () => Date.now();
export function setSsoSyncDiagnosticsClockForTest(clock?: () => number): void { diagnosticNow = clock || (() => Date.now()); }

function errorMessage(error: unknown): string {
  if (error instanceof IdentityProviderFailure) return `Identity provider failure: ${error.code}`;
  if (error instanceof Error) return sanitizeDiagnosticText(error.message);
  if (typeof error === 'string') return sanitizeDiagnosticText(error);
  return 'Unknown SSO sync error';
}

function toRunView(run: SsoSyncRun): SsoSyncRunView {
  return {
    id: run.id, tenantId: run.tenantId, providerId: run.providerId, userId: run.userId,
    trigger: run.trigger as SsoSyncTrigger, status: run.status as SsoSyncRunStatus,
    startedAt: Number(run.startedAt), completedAt: run.completedAt === null ? null : Number(run.completedAt),
    groupMembershipsCreated: Number(run.groupMembershipsCreated), groupMembershipsUpdated: Number(run.groupMembershipsUpdated),
    groupMembershipsRemoved: Number(run.groupMembershipsRemoved), assignmentsCreated: Number(run.assignmentsCreated),
    assignmentsUpdated: Number(run.assignmentsUpdated), assignmentsRemoved: Number(run.assignmentsRemoved),
    errorCode: run.errorCode, errorMessage: run.errorMessage, details: run.details,
  };
}

function toEventView(event: SsoSyncEvent): SsoSyncEventView {
  return {
    id: event.id, tenantId: event.tenantId, providerId: event.providerId, runId: event.runId,
    severity: event.severity as SsoSyncEventView['severity'], type: event.type, userId: event.userId,
    mappingType: event.mappingType, mappingId: event.mappingId, resourceType: event.resourceType,
    resourceId: event.resourceId, message: event.message, details: event.details, createdAt: Number(event.createdAt),
  };
}

class SsoSyncDiagnosticsServiceClass {
  async listRuns(input: ListSsoSyncRunsInput = {}): Promise<SsoSyncRunView[]> {
    const dataSource = await getDataSource();
    const tenantId = normalizeTenantId(input.tenantId);
    const qb = dataSource.getRepository(SsoSyncRun).createQueryBuilder('run').where('1 = 1').orderBy('run.startedAt', 'DESC').take(Math.min(Math.max(input.limit ?? 25, 1), 100));
    if (tenantId) qb.andWhere('(run.tenantId = :tenantId OR run.tenantId IS NULL)', { tenantId }); else qb.andWhere('run.tenantId IS NULL');
    if (input.providerId) qb.andWhere('run.providerId = :providerId', { providerId: input.providerId });
    if (input.userId) qb.andWhere('run.userId = :userId', { userId: input.userId });
    if (input.status) qb.andWhere('run.status = :status', { status: input.status });
    if (input.trigger) qb.andWhere('run.trigger = :trigger', { trigger: input.trigger });
    return (await qb.getMany()).map(toRunView);
  }

  async listEvents(input: ListSsoSyncEventsInput): Promise<SsoSyncEventView[]> {
    const dataSource = await getDataSource();
    const tenantId = normalizeTenantId(input.tenantId);
    const run = await dataSource.getRepository(SsoSyncRun).findOne({
      where: tenantId ? [{ id: input.runId, tenantId }, { id: input.runId, tenantId: IsNull() }] : { id: input.runId, tenantId: IsNull() },
      select: ['id', 'providerId'],
    });
    if (!run || (input.providerId && run.providerId !== input.providerId)) return [];
    const qb = dataSource.getRepository(SsoSyncEvent).createQueryBuilder('event').where('event.runId = :runId', { runId: input.runId }).orderBy('event.createdAt', 'ASC').take(Math.min(Math.max(input.limit ?? 50, 1), 200));
    if (tenantId) qb.andWhere('(event.tenantId = :tenantId OR event.tenantId IS NULL)', { tenantId }); else qb.andWhere('event.tenantId IS NULL');
    if (input.providerId) qb.andWhere('event.providerId = :providerId', { providerId: input.providerId });
    if (input.severity) qb.andWhere('event.severity = :severity', { severity: input.severity });
    return (await qb.getMany()).map(toEventView);
  }

  async runProviderIdentityCheck(input: RunSsoProviderIdentityCheckInput = {}): Promise<SsoProviderIdentityCheckRunResult> {
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = normalizeProviderId(input.providerId);
    const runId = await this.startRun({ tenantId, providerId, trigger: input.trigger || 'scheduled', details: { kind: 'identity_provider_health_check', ...input.details } });
    const result: SsoProviderIdentityCheckRunResult = { runId, scannedIdentities: 0, checkedIdentities: 0, unsupportedIdentities: 0, activeIdentities: 0, inactiveIdentities: 0, deletedIdentities: 0, unknownIdentities: 0, failedIdentities: 0 };
    const record = async (severity: 'info' | 'warning' | 'error', type: string, identity: SsoNormalizedIdentity, message: string, details?: Record<string, unknown>) => {
      if (!runId) return;
      await this.recordEvent(runId, { tenantId: identity.tenantId, providerId: identity.providerId, userId: identity.userId, severity, type, message, resourceType: 'sso_normalized_identity', resourceId: identity.id, details: { providerSubject: identity.providerSubject, subjectClaim: identity.subjectClaim, ...details } });
    };
    try {
      const identityRepo = (await getDataSource()).getRepository(SsoNormalizedIdentity);
      const qb = identityRepo.createQueryBuilder('identity').where('identity.providerStatus = :providerStatus', { providerStatus: 'active' }).orderBy('identity.lastProviderCheckAt', 'ASC').addOrderBy('identity.lastSeenAt', 'ASC').take(Math.min(Math.max(input.limit ?? 500, 1), 5000));
      if (tenantId) qb.andWhere('(identity.tenantId = :tenantId OR identity.tenantId IS NULL)', { tenantId }); else qb.andWhere('identity.tenantId IS NULL');
      if (providerId) qb.andWhere('identity.providerId = :providerId', { providerId });
      const identities = await qb.getMany();
      result.scannedIdentities = identities.length;
      for (const identity of identities) {
        try {
          const check = await ssoProviderIdentityCheckService.checkIdentity(identity);
          if (check.status === 'unsupported') {
            result.unsupportedIdentities += 1;
            await record('warning', 'identity_provider_health_check.identity_unsupported', identity, check.reason, { status: check.status, checkedAt: check.checkedAt, ...check.details });
            continue;
          }
          result.checkedIdentities += 1;
          const update: Record<string, unknown> = { lastProviderCheckAt: check.checkedAt, updatedAt: Date.now() };
          if (check.status === 'active' || check.status === 'inactive' || check.status === 'deleted') update.providerStatus = check.status;
          if (check.status === 'active' && check.profile) {
            update.email = check.profile.email?.trim().toLowerCase() || identity.email;
            update.displayName = check.profile.displayName?.trim() || identity.displayName;
            update.firstName = check.profile.firstName?.trim() || identity.firstName;
            update.lastName = check.profile.lastName?.trim() || identity.lastName;
          }
          await identityRepo.update({ id: identity.id }, update);
          if (check.status === 'active') result.activeIdentities += 1;
          if (check.status === 'inactive') result.inactiveIdentities += 1;
          if (check.status === 'deleted') result.deletedIdentities += 1;
          if (check.status === 'unknown') result.unknownIdentities += 1;
          await record(check.status === 'active' ? 'info' : 'warning', `identity_provider_health_check.identity_${check.status}`, identity, check.reason, { status: check.status, checkedAt: check.checkedAt, ...check.details });
        } catch (error) {
          result.failedIdentities += 1;
          await record('error', 'identity_provider_health_check.identity_failed', identity, errorMessage(error), { reason: errorMessage(error) });
        }
      }
      await this.completeRun(runId, { tenantId, providerId, details: { kind: 'identity_provider_health_check', ...input.details, result } });
      return result;
    } catch (error) {
      await this.failRun(runId, error, { tenantId, providerId, details: { kind: 'identity_provider_health_check', ...input.details } });
      throw error;
    }
  }

  async startRun(input: StartSsoSyncRunInput): Promise<string | null> {
    try {
      const id = generateId(); const now = diagnosticNow(); const details = withCorrelation(input.details, input.correlationId);
      await (await getDataSource()).getRepository(SsoSyncRun).insert({ id, tenantId: normalizeTenantId(input.tenantId), providerId: input.providerId || null, userId: input.userId || null, trigger: input.trigger, status: 'running', startedAt: now, completedAt: null, groupMembershipsCreated: 0, groupMembershipsUpdated: 0, groupMembershipsRemoved: 0, assignmentsCreated: 0, assignmentsUpdated: 0, assignmentsRemoved: 0, errorCode: null, errorMessage: null, details: stringifyDetails(details) });
      await this.recordEvent(id, { tenantId: input.tenantId, providerId: input.providerId, userId: input.userId, severity: 'info', type: 'identity_provider_sync_started', message: 'Identity provider sync started', details });
      return id;
    } catch (error) { logger.warn('Failed to start identity provider sync run:', error); return null; }
  }

  async completeRun(runId: string | null, input: CompleteSsoSyncRunInput = {}): Promise<void> {
    if (!runId) return;
    try {
      const details = withCorrelation(input.details, input.correlationId);
      const counts = { groupMembershipsCreated: input.groupMembershipsCreated ?? 0, groupMembershipsUpdated: input.groupMembershipsUpdated ?? 0, groupMembershipsRemoved: input.groupMembershipsRemoved ?? 0, assignmentsCreated: input.assignmentsCreated ?? 0, assignmentsUpdated: input.assignmentsUpdated ?? 0, assignmentsRemoved: input.assignmentsRemoved ?? 0 };
      await (await getDataSource()).getRepository(SsoSyncRun).update({ id: runId }, { status: 'success', completedAt: diagnosticNow(), ...counts, errorCode: null, errorMessage: null, details: stringifyDetails(details) });
      await this.recordEvent(runId, { tenantId: input.tenantId, providerId: input.providerId, userId: input.userId, severity: 'info', type: 'identity_provider_sync_completed', message: 'Identity provider sync completed', details: { ...details, counts } });
    } catch (error) { logger.warn('Failed to complete identity provider sync run:', error); }
  }

  async failRun(runId: string | null, error: unknown, input: Omit<CompleteSsoSyncRunInput, keyof SsoSyncCounts> = {}): Promise<void> {
    if (!runId) return;
    try {
      const message = errorMessage(error); const details = withCorrelation(input.details, input.correlationId);
      const code = error instanceof IdentityProviderFailure ? error.code : error instanceof Error && error.name ? error.name : 'IdentityProviderSyncError';
      await (await getDataSource()).getRepository(SsoSyncRun).update({ id: runId }, { status: 'failed', completedAt: diagnosticNow(), errorCode: code, errorMessage: message, details: stringifyDetails(details) });
      await this.recordEvent(runId, { tenantId: input.tenantId, providerId: input.providerId, userId: input.userId, severity: 'error', type: 'identity_provider_sync_failed', message, details });
    } catch (diagnosticError) { logger.warn('Failed to mark identity provider sync run as failed:', diagnosticError); }
  }

  private async recordEvent(runId: string, input: { tenantId?: string | null; providerId?: string | null; userId?: string | null; severity: 'info' | 'warning' | 'error'; type: string; message: string; mappingType?: string | null; mappingId?: string | null; resourceType?: string | null; resourceId?: string | null; details?: Record<string, unknown> }): Promise<void> {
    await (await getDataSource()).getRepository(SsoSyncEvent).insert({ id: generateId(), tenantId: normalizeTenantId(input.tenantId), providerId: input.providerId || null, runId, severity: input.severity, type: input.type, userId: input.userId || null, mappingType: input.mappingType || null, mappingId: input.mappingId || null, resourceType: input.resourceType || null, resourceId: input.resourceId || null, message: input.message, details: stringifyDetails(input.details), createdAt: diagnosticNow() });
  }
}

export const ssoSyncDiagnosticsService = new SsoSyncDiagnosticsServiceClass();
