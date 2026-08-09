import { getEngineCapabilities } from '@enterpriseglue/shared/services/bpmn-engine-capabilities.js';
import { parseExternalEngineJson } from './external-engine-serialization.js';

export function parseExternalEngineCapabilities(value: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseExternalEngineJson(value);
  if (!parsed) return null;
  const operations = Array.isArray(parsed.operations)
    ? Array.from(new Set(parsed.operations.filter((operation): operation is string => typeof operation === 'string'))).sort()
    : [];
  const queryCapabilities = parsed.queryCapabilities && typeof parsed.queryCapabilities === 'object' && !Array.isArray(parsed.queryCapabilities)
    ? Object.fromEntries(Object.entries(parsed.queryCapabilities).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
    : undefined;
  return { ...parsed, operations, ...(queryCapabilities ? { queryCapabilities } : {}) };
}

export function getExternalEngineCapabilityDiagnostics(type: unknown, capabilities: Record<string, unknown> | null) {
  const expected = getEngineCapabilities(type);
  const expectedOperations: string[] = [...expected.operations].sort();
  const reportedOperations = Array.isArray(capabilities?.operations)
    ? Array.from(new Set(capabilities.operations.filter((operation): operation is string => typeof operation === 'string'))).sort()
    : [];
  const reported = new Set(reportedOperations);
  const expectedSet = new Set<string>(expectedOperations);
  const missingOperations = expectedOperations.filter((operation) => !reported.has(operation));
  const extraOperations = reportedOperations.filter((operation) => !expectedSet.has(operation));
  const expectedQueryCapabilities = expected.queryCapabilities;
  const rawReportedQueryCapabilities = capabilities?.queryCapabilities;
  const reportedQueryCapabilities = rawReportedQueryCapabilities && typeof rawReportedQueryCapabilities === 'object' && !Array.isArray(rawReportedQueryCapabilities)
    ? rawReportedQueryCapabilities as Record<string, boolean>
    : null;
  const mismatchedQueryCapabilities = Object.entries(expectedQueryCapabilities)
    .filter(([capability, expectedValue]) => reportedQueryCapabilities?.[capability] !== expectedValue)
    .map(([capability]) => capability);
  const status: 'unknown' | 'in_sync' | 'mismatch' = reportedOperations.length === 0
    ? 'unknown'
    : missingOperations.length || mismatchedQueryCapabilities.length ? 'mismatch' : 'in_sync';
  const issues = [
    reportedOperations.length === 0 ? 'No operation capabilities were reported by the external system.' : '',
    missingOperations.length ? `Missing expected operations: ${missingOperations.join(', ')}.` : '',
    extraOperations.length ? `Reported unsupported operations: ${extraOperations.join(', ')}.` : '',
    mismatchedQueryCapabilities.length ? `Missing or incompatible query capabilities: ${mismatchedQueryCapabilities.join(', ')}.` : '',
  ].filter(Boolean);
  return {
    status, expectedOperations, reportedOperations, missingOperations, extraOperations,
    expectedQueryCapabilities, reportedQueryCapabilities, mismatchedQueryCapabilities,
    expectedSupportLevel: expected.supportLevel,
    reportedSupportLevel: typeof capabilities?.supportLevel === 'string' ? capabilities.supportLevel : null,
    expectedCompatibilityProfile: expected.compatibilityProfile,
    reportedCompatibilityProfile: typeof capabilities?.compatibilityProfile === 'string' ? capabilities.compatibilityProfile : null,
    issues,
    recommendation: status === 'in_sync' ? 'No capability action required.' : 'Update the external registration payload to report the missing operations and query capabilities, then run reconcile again.',
  };
}

export function getExternalEngineMaterializationDiagnostics(results: Array<Record<string, unknown>>) {
  const errors = results.filter((result) => typeof result.error === 'string').map((result) => ({ engineSetId: typeof result.engineSetId === 'string' ? result.engineSetId : '', error: String(result.error) }));
  const totals = results.reduce<{ matched: number; created: number; updated: number; removed: number }>((acc, result) => ({
    matched: acc.matched + (typeof result.matched === 'number' ? result.matched : 0), created: acc.created + (typeof result.created === 'number' ? result.created : 0), updated: acc.updated + (typeof result.updated === 'number' ? result.updated : 0), removed: acc.removed + (typeof result.removed === 'number' ? result.removed : 0),
  }), { matched: 0, created: 0, updated: 0, removed: 0 });
  return { engineSetCount: results.length, ...totals, errors, status: errors.length ? 'failed' : 'ok', summary: errors.length ? `${errors.length} Engine Set materialization error${errors.length === 1 ? '' : 's'}` : `${results.length} Engine Set${results.length === 1 ? '' : 's'} checked; ${totals.created} created, ${totals.updated} updated, ${totals.removed} removed` };
}
