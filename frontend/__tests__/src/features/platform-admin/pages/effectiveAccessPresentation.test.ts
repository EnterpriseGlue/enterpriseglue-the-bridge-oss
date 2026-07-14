import { describe, expect, it } from 'vitest';
import {
  effectiveAccessDefaultsFromSearchParams,
  isEffectiveAccessTabRequested,
} from '@src/features/platform-admin/pages/access-control/effectiveAccessPresentation';

describe('Effective Access deep-link defaults', () => {
  it('reads permission and resource context from diagnostic links', () => {
    expect(effectiveAccessDefaultsFromSearchParams(new URLSearchParams({
      permissionId: 'engine:deploy', resourceType: 'engine', resourceId: 'engine-1',
    }))).toEqual({ permission: 'engine:deploy', resourceType: 'engine', resourceId: 'engine-1' });
  });

  it('defaults to platform scope for ordinary navigation', () => {
    expect(effectiveAccessDefaultsFromSearchParams(new URLSearchParams())).toEqual({
      permission: '', resourceType: 'platform', resourceId: '',
    });
  });

  it('recognizes the Effective Access tab link and rejects unsupported resource types', () => {
    const searchParams = new URLSearchParams('tab=effective-access&resourceType=not_a_resource&resourceId=resource-1');

    expect(isEffectiveAccessTabRequested(searchParams)).toBe(true);
    expect(effectiveAccessDefaultsFromSearchParams(searchParams)).toEqual({
      permission: '', resourceType: 'platform', resourceId: 'resource-1',
    });
  });
});
