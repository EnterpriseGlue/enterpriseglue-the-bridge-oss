import { describe, it, expect } from 'vitest';
import { ProjectMembersManagementModals } from '../../../../../../../packages/frontend-host/src/features/starbase/pages/components/ProjectMembersManagementModals';

describe('ProjectMembersManagementModals', () => {
  it('exports ProjectMembersManagementModals component', () => {
    expect(ProjectMembersManagementModals).toBeDefined();
    expect(typeof ProjectMembersManagementModals).toBe('function');
  });
});
