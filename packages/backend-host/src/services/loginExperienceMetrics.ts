import { getLoginExperienceMetricSnapshot } from '@enterpriseglue/shared/auth/login-experience-metrics.js';

export function getLoginExperienceMetrics(): string {
  const snapshot = getLoginExperienceMetricSnapshot();
  return [
    '# HELP enterpriseglue_login_experience_total Authentication UX events without personal, tenant, or provider identifiers.',
    '# TYPE enterpriseglue_login_experience_total counter',
    ...snapshot.map((metric) =>
      `enterpriseglue_login_experience_total{method="${metric.method}",event="${metric.event}"} ${metric.count}`),
    '# HELP enterpriseglue_login_experience_duration_ms_sum Total bounded elapsed milliseconds for completed authentication UX events.',
    '# TYPE enterpriseglue_login_experience_duration_ms_sum counter',
    ...snapshot.map((metric) =>
      `enterpriseglue_login_experience_duration_ms_sum{method="${metric.method}",event="${metric.event}"} ${metric.durationMsSum}`),
    '# HELP enterpriseglue_login_experience_duration_ms_count Completed authentication UX events with an elapsed-time observation.',
    '# TYPE enterpriseglue_login_experience_duration_ms_count counter',
    ...snapshot.map((metric) =>
      `enterpriseglue_login_experience_duration_ms_count{method="${metric.method}",event="${metric.event}"} ${metric.durationCount}`),
    '',
  ].join('\n');
}
