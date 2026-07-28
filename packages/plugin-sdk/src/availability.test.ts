import { describe, expect, it } from 'vitest';

import { pluginContributionAvailabilityProjectionV1Schema } from './availability.js';

describe('pluginContributionAvailabilityProjectionV1Schema', () => {
  const projection = {
    apiVersion:
      'contribution-availability.plugin.enterpriseglue.io/v1',
    evaluatedAt: '2026-07-26T00:00:00.000Z',
    validUntil: '2026-07-26T00:15:00.000Z',
    contributions: [
      {
        contributionId: 'io.enterpriseglue.reference.action',
        available: true,
        reasonCode: 'available',
      },
    ],
  };

  it('accepts only consistent closed entries', () => {
    expect(
      pluginContributionAvailabilityProjectionV1Schema.parse(projection),
    ).toEqual(projection);
    expect(() =>
      pluginContributionAvailabilityProjectionV1Schema.parse({
        ...projection,
        customerRef: 'must-not-leak',
      }),
    ).toThrow();
    expect(() =>
      pluginContributionAvailabilityProjectionV1Schema.parse({
        ...projection,
        contributions: [
          {
            ...projection.contributions[0],
            available: false,
            reasonCode: 'available',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects duplicate IDs and invalid time order', () => {
    expect(() =>
      pluginContributionAvailabilityProjectionV1Schema.parse({
        ...projection,
        contributions: [
          projection.contributions[0],
          projection.contributions[0],
        ],
      }),
    ).toThrow();
    expect(() =>
      pluginContributionAvailabilityProjectionV1Schema.parse({
        ...projection,
        validUntil: projection.evaluatedAt,
      }),
    ).toThrow();
  });
});
