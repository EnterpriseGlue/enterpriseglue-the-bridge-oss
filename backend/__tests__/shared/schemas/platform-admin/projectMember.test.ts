import { describe, expect, it } from 'vitest';
import {
  ProjectMemberCapabilitiesSchema,
  ProjectMemberAddResponseSchema,
  ProjectDeployGrantResponseSchema,
  ProjectMemberLookupSchema,
  ProjectMembersResponseSchema,
  ReissuedManualProjectInvitationSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/project-member.js';

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

describe('Project member mutation contracts', () => {
  it('distinguishes direct member adds from invitation responses', () => {
    expect(ProjectMemberAddResponseSchema.parse({
      id: 'member-1',
      projectId: 'project-1',
      userId: 'user-1',
      role: 'viewer',
      roles: ['viewer'],
      user: { id: 'user-1', email: 'member@example.com' },
      invited: false,
    })).toMatchObject({ invited: false, userId: 'user-1' });
    expect(ProjectMemberAddResponseSchema.parse({
      invited: true,
      emailSent: false,
      inviteUrl: 'https://localhost/invite/token',
      oneTimePassword: 'one-time-password',
    })).toMatchObject({ invited: true, emailSent: false });
  });

  it('models deploy grants and manual reissue responses', () => {
    expect(ProjectDeployGrantResponseSchema.parse({ allowed: true })).toEqual({ allowed: true });
    expect(ReissuedManualProjectInvitationSchema.parse({
      invited: true,
      emailSent: false,
      inviteUrl: 'https://localhost/invite/token',
      oneTimePassword: 'one-time-password',
    })).toMatchObject({ invited: true, emailSent: false });
  });
});

describe('Project member invitation contracts', () => {
  it('models lookup candidates and no-candidate existing-member responses', () => {
    expect(ProjectMemberLookupSchema.parse({
      mode: 'direct-add',
      user: {
        id: 'user-1',
        email: 'member@example.com',
        firstName: 'Member',
        lastName: null,
      },
    })).toMatchObject({ mode: 'direct-add', user: { id: 'user-1' } });
    expect(ProjectMemberLookupSchema.parse({ mode: 'existing-member', user: null }))
      .toEqual({ mode: 'existing-member', user: null });
  });

  it('models invitation delivery capabilities shared by OpenAPI and the UI', () => {
    expect(ProjectMemberCapabilitiesSchema.parse({ ssoRequired: true, emailConfigured: false }))
      .toEqual({ ssoRequired: true, emailConfigured: false });
  });
});
