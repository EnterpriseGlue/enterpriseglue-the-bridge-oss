import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLoginExperienceMetricSnapshot,
  recordLoginExperienceMetric,
  resetLoginExperienceMetricsForTests,
} from '@enterpriseglue/shared/auth/login-experience-metrics.js';
import { getLoginExperienceMetrics } from '../../../packages/backend-host/src/services/loginExperienceMetrics.js';

describe('login experience operational metrics', () => {
  beforeEach(() => {
    resetLoginExperienceMetricsForTests();
  });

  it('records only bounded method and event labels with capped duration aggregates', () => {
    recordLoginExperienceMetric({ method: 'oidc', event: 'selected' });
    recordLoginExperienceMetric({ method: 'oidc', event: 'succeeded', durationMs: 1_250 });
    recordLoginExperienceMetric({ method: 'recovery', event: 'failed', durationMs: 999_999_999 });

    const oidcSuccess = getLoginExperienceMetricSnapshot().find((metric) =>
      metric.method === 'oidc' && metric.event === 'succeeded');
    const recoveryFailure = getLoginExperienceMetricSnapshot().find((metric) =>
      metric.method === 'recovery' && metric.event === 'failed');

    expect(oidcSuccess).toMatchObject({ count: 1, durationCount: 1, durationMsSum: 1_250 });
    expect(recoveryFailure).toMatchObject({ count: 1, durationCount: 1, durationMsSum: 600_000 });
  });

  it('exports privacy-safe Prometheus counters without provider, tenant, user, or email labels', () => {
    recordLoginExperienceMetric({ method: 'saml', event: 'redirect_failed', durationMs: 400 });

    const metrics = getLoginExperienceMetrics();

    expect(metrics).toContain('enterpriseglue_login_experience_total{method="saml",event="redirect_failed"} 1');
    expect(metrics).toContain('enterpriseglue_login_experience_duration_ms_sum{method="saml",event="redirect_failed"} 400');
    expect(metrics).toContain('enterpriseglue_login_experience_duration_ms_count{method="saml",event="redirect_failed"} 1');
    expect(metrics).not.toMatch(/\{[^}]*\b(provider|tenant|user|email|domain|request_id)=/);
  });
});
