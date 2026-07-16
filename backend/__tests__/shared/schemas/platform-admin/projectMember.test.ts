import { describe, expect, it } from 'vitest';
import { ProjectMembersResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/project-member.js';

describe('ProjectMembersResponseSchema', () => {
  it('models members and unresolved invitations returned by the Starbase route', () => {
    expect(ProjectMembersResponseSchema.parse({
      members: [{
        id: 'member-1',
        projectId: 'project-1',
        userId: 'user-1',
        role: 'editor',
        roles: ['editor'],
        deployAllowed: false,
        joinedAt: 1,
        user: null,
      }],
      pendingInvites: [{
        invitationId: 'invite-1',
        userId: 'user-2',
        email: 'invitee@example.com',
        role: 'viewer',
        roles: ['viewer'],
        status: 'pending',
        deliveryMethod: 'email',
        expiresAt: 2,
        createdAt: 1,
      }],
    })).toMatchObject({
      members: [{ deployAllowed: false, user: null }],
      pendingInvites: [{ status: 'pending', deliveryMethod: 'email' }],
    });
  });
});
