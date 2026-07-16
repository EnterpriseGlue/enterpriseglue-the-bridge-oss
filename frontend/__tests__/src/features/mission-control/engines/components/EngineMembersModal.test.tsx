import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import EngineMembersModal from '@src/features/mission-control/engines/components/EngineMembersModal';
import { apiClient } from '@src/shared/api/client';

vi.mock('@carbon/react', async () => {
  const actual = await vi.importActual<any>('@carbon/react');
  return {
    ...actual,
    OverflowMenu: ({ children, iconDescription }: any) => (
      <span>
        <button type="button">{iconDescription || 'Options'}</button>
        <span>{children}</span>
      </span>
    ),
    OverflowMenuItem: ({ itemText, onClick, disabled }: any) => (
      <button type="button" disabled={Boolean(disabled)} onClick={onClick}>
        {itemText}
      </button>
    ),
  };
});

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('EngineMembersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes('/members/capabilities')) {
        return { ssoRequired: false, emailConfigured: true };
      }

      if (url.includes('/members/lookup')) {
        return { mode: 'invite', user: null };
      }

      if (url.includes('/members')) {
        return {
          members: [
            {
              id: 'member-1',
              engineId: 'engine-1',
              userId: 'user-2',
              role: 'operator',
              grantedAt: Date.now(),
              user: { id: 'user-2', email: 'operator@example.com', firstName: 'Operator', lastName: 'User' },
            },
          ],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/roles' || url === '/api/authz/role-assignments' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });
  });

  it('exports EngineMembersModal component', () => {
    expect(EngineMembersModal).toBeDefined();
    expect(typeof EngineMembersModal).toBe('function');
  });

  function renderModal(overrides: Partial<Parameters<typeof EngineMembersModal>[0]> = {}) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const props: Parameters<typeof EngineMembersModal>[0] = {
      open: true,
      engine: { id: 'engine-1', name: 'Dev Engine' },
      canManage: false,
      canViewMembers: true,
      canLookupMembers: false,
      canInviteMembers: false,
      canAddMembers: false,
      canUpdateMemberRoles: false,
      canRemoveMembers: false,
      canManageDelegate: false,
      canViewProjectAccess: false,
      canApproveProjectAccess: false,
      canDenyProjectAccess: false,
      onClose: vi.fn(),
      ...overrides,
    };

    return {
      props,
      ...render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/t/default/engines']}>
            <EngineMembersModal {...props} />
          </MemoryRouter>
        </QueryClientProvider>
      ),
    };
  }

  it('shows invite user only when lookup and invite permission are available', async () => {
    renderModal({ canLookupMembers: true, canInviteMembers: true });

    expect(await screen.findByRole('button', { name: /invite user/i })).toBeInTheDocument();
  });

  it('directs existing users from invitation flow to scoped assignment', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string, params?: any) => {
      if (url.includes('/members/capabilities')) {
        return { ssoRequired: false, emailConfigured: true };
      }

      if (url.includes('/members/lookup')) {
        return {
          mode: 'direct-add',
          user: {
            id: 'user-3',
            email: String(params?.email || 'direct@example.com'),
            firstName: 'Direct',
            lastName: 'User',
          },
        };
      }

      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/roles' || url === '/api/authz/role-assignments' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'unexpected' });

    renderModal({ canLookupMembers: true, canInviteMembers: true, canAddMembers: true });

    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText('Email'), 'direct@example.com');
    expect(await screen.findByText('Use Assign access')).toBeInTheDocument();

    const submitButton = screen.getByRole('button', { name: /create invitation/i });
    expect(submitButton).toBeDisabled();
    await userEvent.click(submitButton);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('assigns existing users as delegates through the delegate flow', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string, params?: any) => {
      if (url.includes('/members/lookup')) {
        return {
          mode: 'direct-add',
          user: {
            id: 'user-4',
            email: String(params?.email || 'delegate@example.com'),
            firstName: 'Delegate',
            lastName: 'User',
          },
        };
      }

      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/roles' || url === '/api/authz/role-assignments' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'delegate-update' });

    renderModal({ canLookupMembers: true, canManageDelegate: true });

    await userEvent.click(await screen.findByRole('button', { name: /assign delegate/i }));
    await userEvent.type(screen.getByLabelText('Email'), 'delegate@example.com');
    expect(await screen.findByText('delegate@example.com will be assigned as delegate.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /save delegate/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/engines-api/engines/engine-1/delegate',
        { email: 'delegate@example.com' },
        { credentials: 'include' },
      );
    });
  });

  it('shows role update action without remove when only update permission is available', async () => {
    renderModal({ canUpdateMemberRoles: true });

    expect(await screen.findByText('Operator User')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Change role to Deployer')).toBeInTheDocument();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('shows remove action without role update when only remove permission is available', async () => {
    renderModal({ canRemoveMembers: true });

    expect(await screen.findByText('Operator User')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Remove')).toBeInTheDocument();
    expect(screen.queryByText('Change role to Deployer')).toBeNull();
  });

  it('assigns scoped group access through the role assignments API', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/roles') {
        return [
          {
            id: 'system.engine.operator',
            name: 'Engine Operator',
            scope: 'engine',
            kind: 'system',
            isAssignable: true,
            isArchived: false,
          },
        ];
      }

      if (url === '/api/authz/role-assignments' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'assignment-1' });

    const { container } = renderModal({ canAddMembers: true, canUpdateMemberRoles: true });

    await userEvent.click(await screen.findByRole('button', { name: /assign access/i }));
    await userEvent.selectOptions(screen.getByLabelText('Principal type'), 'group');
    await userEvent.type(screen.getByLabelText('Group ID'), 'group-1');
    await screen.findByText('Engine Operator');
    await userEvent.selectOptions(container.querySelector('#engine-scoped-assignment-role') as HTMLSelectElement, 'system.engine.operator');
    await userEvent.click(screen.getByRole('button', { name: /^assign$/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/authz/role-assignments', {
        principalType: 'group',
        principalId: 'group-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
      }, { credentials: 'include' });
    });
  });

  it('shows SSO lineage for scoped RBAC assignments', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/role-assignments') {
        return [
          {
            id: 'assignment-sso-1',
            userId: 'group-ops',
            principalType: 'group',
            principalId: 'group-ops',
            roleId: 'system.engine.operator',
            roleName: 'Engine Operator',
            roleScope: 'engine',
            resourceType: 'engine',
            resourceId: 'engine-1',
            scopeType: 'engine',
            scopeId: 'engine-1',
            source: 'sso',
            sourceMappingId: 'mapping-1',
            sourceRef: 'sso-group:payments-ops',
          },
        ];
      }

      if (url === '/api/authz/roles' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });

    renderModal({ canAddMembers: true });

    expect(await screen.findByText('Group: group-ops')).toBeInTheDocument();
    expect(screen.getByText('Lineage: SSO-managed assignment; Source ref sso-group:payments-ops; SSO mapping mapping-1')).toBeInTheDocument();
  });

  it('shows SSO scoped assignments as non-removable in SSO-managed mode', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [],
        };
      }

      if (url === '/api/authz/role-assignments') {
        return [
          {
            id: 'assignment-sso-1',
            userId: 'group-ops',
            principalType: 'group',
            principalId: 'group-ops',
            roleId: 'system.engine.operator',
            roleName: 'Engine Operator',
            roleScope: 'engine',
            resourceType: 'engine',
            resourceId: 'engine-1',
            scopeType: 'engine',
            scopeId: 'engine-1',
            source: 'sso',
            sourceMappingId: 'mapping-1',
            sourceRef: 'sso-group:payments-ops',
          },
        ];
      }

      if (url === '/api/authz/roles' || url.includes('/access-requests')) {
        return [];
      }

      return [];
    });

    renderModal({ canAddMembers: true, engineAccessAuthority: 'sso_managed' });

    expect(await screen.findByText('Group: group-ops')).toBeInTheDocument();
    expect(screen.getByText('Managed by SSO mapping')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows manual invitation reissue only for invite permission', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) {
        return {
          members: [],
          pendingInvites: [
            {
              invitationId: 'invite-1',
              userId: 'pending-user',
              email: 'pending@example.com',
              firstName: 'Pending',
              lastName: 'User',
              role: 'operator',
              status: 'pending',
              deliveryMethod: 'manual',
              expiresAt: Date.now() + 3600_000,
              createdAt: Date.now(),
            },
          ],
        };
      }

      return [];
    });

    renderModal({ canInviteMembers: true });

    expect(await screen.findByText('Pending User')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /invitation options/i }));

    expect(await screen.findByText('Regenerate invite link and OTP')).toBeInTheDocument();
  });

  it('does not query members when only project-access review is available', async () => {
    renderModal({
      canViewMembers: false,
      canViewProjectAccess: true,
    });

    expect(await screen.findByText('Member list unavailable')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/engines-api/engines/engine-1/access-requests',
        undefined,
        { credentials: 'include' }
      );
      expect(apiClient.get).not.toHaveBeenCalledWith(
        '/engines-api/engines/engine-1/members',
        undefined,
        { credentials: 'include' }
      );
    });
  });
});
