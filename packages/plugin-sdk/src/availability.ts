import { z } from 'zod';

import { namespacedIdentifierSchema } from './common.js';

export const pluginContributionAvailabilityReasonCodeV1Schema = z.enum([
  'available',
  'not_entitled',
  'dependency_unavailable',
  'dependency_incompatible',
  'feature_unavailable',
  'policy_blocked',
]);

export const pluginContributionAvailabilityEntryV1Schema = z
  .object({
    contributionId: namespacedIdentifierSchema,
    available: z.boolean(),
    reasonCode: pluginContributionAvailabilityReasonCodeV1Schema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.available !== (entry.reasonCode === 'available')) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message:
          'Available contributions must use available; unavailable contributions must use a closed failure reason',
      });
    }
  });

export const pluginContributionAvailabilityProjectionV1Schema = z
  .object({
    apiVersion: z.literal(
      'contribution-availability.plugin.enterpriseglue.io/v1',
    ),
    evaluatedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    contributions: z
      .array(pluginContributionAvailabilityEntryV1Schema)
      .max(500),
  })
  .strict()
  .superRefine((projection, context) => {
    if (Date.parse(projection.validUntil) <= Date.parse(projection.evaluatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Availability validity must end after evaluation',
      });
    }
    const ids = new Set<string>();
    for (const [index, entry] of projection.contributions.entries()) {
      if (ids.has(entry.contributionId)) {
        context.addIssue({
          code: 'custom',
          path: ['contributions', index, 'contributionId'],
          message: 'Availability contribution IDs must be unique',
        });
      }
      ids.add(entry.contributionId);
    }
  });

export type PluginContributionAvailabilityReasonCodeV1 = z.infer<
  typeof pluginContributionAvailabilityReasonCodeV1Schema
>;
export type PluginContributionAvailabilityEntryV1 = z.infer<
  typeof pluginContributionAvailabilityEntryV1Schema
>;
export type PluginContributionAvailabilityProjectionV1 = z.infer<
  typeof pluginContributionAvailabilityProjectionV1Schema
>;
