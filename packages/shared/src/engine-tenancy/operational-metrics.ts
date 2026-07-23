export const ENGINE_TENANCY_FALLBACK_DECLARATIONS = [
  'omitted',
  'explicit_request_context',
] as const;

export type EngineTenancyFallbackDeclaration = typeof ENGINE_TENANCY_FALLBACK_DECLARATIONS[number];
export type EngineTenancyFallbackPrincipalType = 'user' | 'api_client' | 'service_account' | 'system';

export interface EngineTenancyFallbackMetric {
  principalType: EngineTenancyFallbackPrincipalType;
  declaration: EngineTenancyFallbackDeclaration;
  count: number;
}

const fallbackCounts = new Map<string, number>();

function fallbackKey(
  principalType: EngineTenancyFallbackPrincipalType,
  declaration: EngineTenancyFallbackDeclaration,
): string {
  return `${principalType}:${declaration}`;
}

export function recordEngineTenancyDefaultFallback(input: {
  principalType: EngineTenancyFallbackPrincipalType;
  declaration: EngineTenancyFallbackDeclaration;
}): void {
  const key = fallbackKey(input.principalType, input.declaration);
  fallbackCounts.set(key, (fallbackCounts.get(key) || 0) + 1);
}

export function getEngineTenancyDefaultFallbackMetrics(): EngineTenancyFallbackMetric[] {
  const principalTypes: EngineTenancyFallbackPrincipalType[] = ['user', 'api_client', 'service_account', 'system'];
  return principalTypes.flatMap((principalType) =>
    ENGINE_TENANCY_FALLBACK_DECLARATIONS.map((declaration) => ({
      principalType,
      declaration,
      count: fallbackCounts.get(fallbackKey(principalType, declaration)) || 0,
    })));
}

/** Test-only reset for deterministic process-local counter assertions. */
export function resetEngineTenancyOperationalMetricsForTests(): void {
  fallbackCounts.clear();
}
