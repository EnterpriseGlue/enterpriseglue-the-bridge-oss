export const LOGIN_EXPERIENCE_METHODS = ['local', 'recovery', 'oidc', 'saml', 'ldap'] as const;
export const LOGIN_EXPERIENCE_EVENTS = ['selected', 'succeeded', 'failed', 'redirect_failed'] as const;

export type LoginExperienceMethod = typeof LOGIN_EXPERIENCE_METHODS[number];
export type LoginExperienceEvent = typeof LOGIN_EXPERIENCE_EVENTS[number];

export interface LoginExperienceMetric {
  method: LoginExperienceMethod;
  event: LoginExperienceEvent;
  count: number;
  durationCount: number;
  durationMsSum: number;
}

const counts = new Map<string, number>();
const durationCounts = new Map<string, number>();
const durationSums = new Map<string, number>();

function metricKey(method: LoginExperienceMethod, event: LoginExperienceEvent): string {
  return `${method}:${event}`;
}

/**
 * Records bounded, process-local authentication UX metrics. Labels deliberately
 * exclude user, provider, tenant, email, domain, IP, and request identifiers.
 */
export function recordLoginExperienceMetric(input: {
  method: LoginExperienceMethod;
  event: LoginExperienceEvent;
  durationMs?: number;
}): void {
  const key = metricKey(input.method, input.event);
  counts.set(key, (counts.get(key) || 0) + 1);
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0) {
    const boundedDuration = Math.min(Math.round(input.durationMs), 10 * 60 * 1000);
    durationCounts.set(key, (durationCounts.get(key) || 0) + 1);
    durationSums.set(key, (durationSums.get(key) || 0) + boundedDuration);
  }
}

export function getLoginExperienceMetricSnapshot(): LoginExperienceMetric[] {
  return LOGIN_EXPERIENCE_METHODS.flatMap((method) =>
    LOGIN_EXPERIENCE_EVENTS.map((event) => {
      const key = metricKey(method, event);
      return {
        method,
        event,
        count: counts.get(key) || 0,
        durationCount: durationCounts.get(key) || 0,
        durationMsSum: durationSums.get(key) || 0,
      };
    }));
}

/** Test-only reset for deterministic process-local counter assertions. */
export function resetLoginExperienceMetricsForTests(): void {
  counts.clear();
  durationCounts.clear();
  durationSums.clear();
}
