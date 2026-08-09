import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DecisionHistoryDetail from '@src/features/mission-control/decision-instance-detail/components/DecisionHistoryDetail';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { apiClient } from '@src/shared/api/client';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'decision-1' }),
  useLocation: () => ({ search: '', state: null }),
}));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    toTenantPath: (path: string) => path,
  }),
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

function renderDecisionHistoryDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const authContext = {
    user: null,
    permissions: {
      userId: 'user-1',
      tenantId: null,
      platform: [],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
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
  } satisfies AuthContextValue;

  return render(
    <AuthContext.Provider value={authContext}>
      <QueryClientProvider client={queryClient}>
        <DecisionHistoryDetail />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

describe('DecisionHistoryDetail', () => {
  it('does not fetch decision history when the selected engine read action is denied', () => {
    renderDecisionHistoryDetail();

    expect(screen.getByText('Decision history unavailable')).toBeInTheDocument();
    expect(screen.getByText('Missing permission engine:instance:view')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
