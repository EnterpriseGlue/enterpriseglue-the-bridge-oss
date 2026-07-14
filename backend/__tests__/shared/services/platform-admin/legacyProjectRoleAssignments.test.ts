import { describe, expect, it, vi } from 'vitest';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';
import { writeLegacyProjectMemberRoleAssignments } from '@enterpriseglue/shared/services/platform-admin/legacy-project-role-assignments.js';

describe('legacy project role assignments', () => {
  it('writes canonical fields without deprecated assignment aliases', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return { upsert };
        throw new Error('Unexpected repository');
      },
    } as any;

    await writeLegacyProjectMemberRoleAssignments(store, {
      projectId: 'project-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['developer'],
      createdById: 'admin-1',
      createdAt: 100,
    });

    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'legacy:project:project-1:user-1:system.project.developer',
        tenantId: 'tenant-1',
        principalType: 'user',
        principalId: 'user-1',
        roleId: 'system.project.developer',
        scopeType: 'project',
        scopeId: 'project-1',
        source: 'legacy',
        sourceRef: 'project_member_role:project-1:user-1:developer',
      }),
    ], expect.objectContaining({ conflictPaths: ['id'] }));

    const assignment = upsert.mock.calls[0][0][0];
    expect(assignment).not.toHaveProperty('userId');
    expect(assignment).not.toHaveProperty('resourceType');
    expect(assignment).not.toHaveProperty('resourceId');
    expect(assignment).not.toHaveProperty('sourceMappingId');
  });
});
