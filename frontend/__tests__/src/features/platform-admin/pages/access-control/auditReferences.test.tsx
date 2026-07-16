import { describe, expect, it } from 'vitest';
import {
  findAssignmentAuditEntries,
  findMachineIdentityAuditEntries,
  findMembershipAuditEntries,
} from '@src/features/platform-admin/pages/access-control/auditReferences';
import type {
  AuthzAuditEntry,
  AuthzGroupMembership,
  IdentityEntitlementMapping,
  RoleAssignment,
  SsoAssignmentMapping,
} from '@src/features/platform-admin/hooks/useAuthzApi';

const auditEntry = (overrides: Partial<AuthzAuditEntry>): AuthzAuditEntry => ({
  id: 'audit-1',
  userId: 'admin-1',
  action: 'role_assignment.create',
  resourceType: 'role_assignment',
  resourceId: 'assignment-1',
  decision: 'allow',
  reason: '',
  policyId: null,
  context: '',
  ipAddress: null,
  userAgent: null,
  timestamp: 1,
  ...overrides,
});

describe('audit references', () => {
  it('correlates direct assignment entries by assignment and mapping lineage', () => {
    const assignment = { id: 'assignment-1', sourceMappingId: 'mapping-1', sourceRef: 'sso:mapping-1' } as RoleAssignment;
    const mapping = { id: 'mapping-1' } as SsoAssignmentMapping;

    expect(findAssignmentAuditEntries(assignment, [
      auditEntry({ id: 'matching-assignment' }),
      auditEntry({ id: 'matching-mapping', resourceType: 'sso_assignment_mapping', resourceId: 'mapping-1', action: 'sso_assignment_mapping.update' }),
      auditEntry({ id: 'read-only', action: 'role_assignment.read' }),
    ], mapping).map((entry) => entry.id)).toEqual(['matching-assignment', 'matching-mapping']);
  });

  it('correlates provider-managed memberships without treating read events as audit mutations', () => {
    const membership = { id: 'membership-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1', groupId: 'group-1', userId: 'user-1' } as AuthzGroupMembership;

    expect(findMembershipAuditEntries(membership, [
      auditEntry({ id: 'matching-membership', resourceType: 'authz_group_membership', resourceId: 'membership-1', action: 'authz_group_membership.sync' }),
      auditEntry({ id: 'matching-mapping', resourceType: 'identity_entitlement_mapping', resourceId: 'mapping-1', action: 'identity_entitlement_mapping.update' }),
      auditEntry({ id: 'read-only', resourceType: 'authz_group_membership', resourceId: 'membership-1', action: 'authz_group_membership.read' }),
    ], { id: 'mapping-1' } as IdentityEntitlementMapping).map((entry) => entry.id)).toEqual(['matching-membership', 'matching-mapping']);
  });

  it('correlates machine-principal lifecycle and assignment mutations only', () => {
    expect(findMachineIdentityAuditEntries('api_client', 'client-1', [
      auditEntry({ id: 'matching-client', resourceType: 'api_client', resourceId: 'client-1', action: 'api_client.rotate' }),
      auditEntry({ id: 'matching-assignment', resourceType: 'role_assignment', context: JSON.stringify({ principalId: 'client-1' }), action: 'role_assignment.create' }),
      auditEntry({ id: 'read-only', resourceType: 'api_client', resourceId: 'client-1', action: 'api_client.read' }),
    ]).map((entry) => entry.id)).toEqual(['matching-client', 'matching-assignment']);
  });
});
