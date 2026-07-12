import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BatchOperationForm from '@src/features/mission-control/batches/components/BatchOperationForm';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    tenantSlug: 'default',
    effectivePathname: '/',
    navigate: vi.fn(),
    toTenantPath: (p: string) => p,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

const deniedAuthContext: AuthContextValue = {
  user: null,
  permissions: {
    userId: 'user-1',
    platform: [],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
    generatedAt: 1,
  },
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  refreshUser: vi.fn(),
  setAuthenticatedUser: vi.fn(),
  refreshPermissions: vi.fn(),
  hasPlatformPermission: vi.fn(),
  hasAnyPlatformPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
  hasAnyProjectPermission: vi.fn(),
  hasAnyEnginePermission: vi.fn(),
  hasEnginePermission: vi.fn(),
  hasAnyScopedEnginePermission: vi.fn(),
};

describe('BatchOperationForm', () => {
  it('renders form with correct title for delete operation', () => {
    render(<BatchOperationForm operationType="delete" />);
    expect(screen.getByText('Cancel Process Instances')).toBeInTheDocument();
  });

  it('renders form with correct title for activate operation', () => {
    render(<BatchOperationForm operationType="activate" />);
    expect(screen.getByText('Activate Process Instances')).toBeInTheDocument();
  });

  it('renders retries field for retries operation', () => {
    render(<BatchOperationForm operationType="retries" />);
    expect(screen.getByLabelText(/Number of Retries/i)).toBeInTheDocument();
  });

  it('disables submit with the missing permission reason when batch creation is denied', () => {
    render(
      <AuthContext.Provider value={deniedAuthContext}>
        <BatchOperationForm operationType="delete" />
      </AuthContext.Provider>
    );

    const submit = screen.getByRole('button', { name: /Create Cancel Process Instances/i });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('title', 'Missing permission engine:instance:delete');
  });
});
