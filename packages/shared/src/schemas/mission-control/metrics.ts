import { z } from 'zod';

// Metrics schemas (API-only, no DB persistence)
export const MetricSchema = z.object({
  timestamp: z.string(),
  name: z.string(),
  reporter: z.string().optional().nullable(),
  value: z.number(),
});

export const MetricsResultSchema = z.array(MetricSchema);

// Query params
export const MetricsQueryParams = z.object({
  name: z.string().optional(),
  reporter: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
  interval: z.enum(['15', '60', '900']).optional(), // 15m, 1h, 15m intervals
  aggregateByReporter: z.boolean().optional(),
});

// Metric names enum for type safety
export const MetricNameSchema = z.enum([
  'activity-instance-start',
  'activity-instance-end',
  'job-acquisition-attempt',
  'job-acquired-success',
  'job-acquired-failure',
  'job-execution-rejected',
  'job-successful',
  'job-failed',
  'job-locked-exclusive',
  'executed-decision-elements',
  'executed-decision-instances',
  'root-process-instance-start',
  'unique-task-workers',
]);

// Types
export type Metric = z.infer<typeof MetricSchema>;
export type MetricsResult = z.infer<typeof MetricsResultSchema>;
export type MetricsQueryParams = z.infer<typeof MetricsQueryParams>;
export type MetricName = z.infer<typeof MetricNameSchema>;
