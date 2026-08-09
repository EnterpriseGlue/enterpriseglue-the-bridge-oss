import { describe, expect, it } from 'vitest';
import { accessControlTabFromSearchParams } from '@src/features/platform-admin/pages/access-control/accessControlTabPresentation';

describe('Access Control tab deep links', () => {
  it('recognizes URL-friendly and internal tab ids', () => {
    expect(accessControlTabFromSearchParams(new URLSearchParams('tab=project-targets'))).toBe('project_targets');
    expect(accessControlTabFromSearchParams(new URLSearchParams('tab=external_registration'))).toBe('external_registration');
  });

  it('fails closed to the page default for unknown tab ids', () => {
    expect(accessControlTabFromSearchParams(new URLSearchParams('tab=does-not-exist'))).toBeNull();
  });
});
