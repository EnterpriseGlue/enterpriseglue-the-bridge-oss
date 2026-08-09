import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuditLogViewer from '@src/pages/AuditLogViewer';
import { apiClient } from '@src/shared/api/client';
import { PlatformPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

const authState: {
  user: { capabilities: Record<string, boolean> };
  permissions: CurrentUserPermissions;
  hasPlatformPermission: ReturnType<typeof vi.fn>;
} = {
  user: { capabilities: {} },
  permissions: {
    userId: 'user-1',
    tenantId: null,
    platform: [PlatformPermission.AUDIT_VIEW],
    projects: [],
    engines: [],
    authorizationVersion: 'test-authz-v1',
    generatedAt: 1,
  },
  hasPlatformPermission: vi.fn(),
};

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

function mockAuditApi() {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/audit/logs') {
      return { logs: [], pagination: { total: 0 } };
    }
    if (url === '/api/audit/stats') {
      return { total: 0, last24Hours: 0, failedLogins: 0, byAction: [], byUser: [] };
    }
    if (url === '/api/audit/actions') {
      return { actions: [] };
    }
    return {};
  });
}

function renderAuditLogViewer() {
  return render(
    <MemoryRouter>
      <AuditLogViewer />
    </MemoryRouter>
  );
}

describe('AuditLogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditApi();
    authState.user = { capabilities: {} };
    authState.permissions = {
      userId: 'user-1',
      tenantId: null,
      platform: [PlatformPermission.AUDIT_VIEW],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };
    authState.hasPlatformPermission.mockImplementation((permission: string) =>
      permission === PlatformPermission.AUDIT_VIEW
    );
  });

  it('exports AuditLogViewer page component', () => {
    expect(AuditLogViewer).toBeDefined();
    expect(typeof AuditLogViewer).toBe('function');
  });

  it('hides the unredacted PII toggle without the elevated audit permission', async () => {
    renderAuditLogViewer();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/audit/logs', expect.any(Object)));
    expect(screen.queryByText('Show unredacted PII')).not.toBeInTheDocument();
  });

  it('requests unredacted audit payloads only when the elevated toggle is enabled', async () => {
    authState.permissions = {
      userId: 'user-1',
      tenantId: null,
      platform: [PlatformPermission.AUDIT_VIEW, PlatformPermission.AUDIT_UNREDACTED_VIEW],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };
    authState.hasPlatformPermission.mockImplementation((permission: string) =>
      permission === PlatformPermission.AUDIT_VIEW ||
      permission === PlatformPermission.AUDIT_UNREDACTED_VIEW
    );

    renderAuditLogViewer();

    await waitFor(() => expect(screen.getByText('Show unredacted PII')).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith('/api/audit/logs', expect.not.objectContaining({ includePii: true }));

    await userEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/audit/logs',
      expect.objectContaining({ includePii: true })
    ));
  });
});
