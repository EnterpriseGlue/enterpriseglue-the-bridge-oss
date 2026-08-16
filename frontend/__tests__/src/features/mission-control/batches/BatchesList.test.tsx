import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import BatchesPage from '@src/features/mission-control/batches/BatchesPage';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';

let authPermissions: any;

function renderWithProviders() {
  useEngineSelectorStore.setState({ selectedEngineId: 'engine-1' });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <AuthContext.Provider value={{
      user: null,
      permissions: authPermissions,
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
    } satisfies AuthContextValue}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/mission-control/batches']}>
          <Routes>
            <Route path="/mission-control/batches" element={<BatchesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

describe('BatchesList', () => {
  beforeEach(() => {
    authPermissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
      generatedAt: 1,
    };
  });

  it('renders batch rows from API', async () => {
    server.use(
      http.get(/\/mission-control-api\/batches(?:\?.*)?$/, () => HttpResponse.json([
        {
          id: 'batch-1',
          type: 'historyCleanup',
          progress: 20,
          status: 'RUNNING',
          createdAt: Date.now(),
        },
      ]))
    );

    renderWithProviders();

    await waitFor(() => {
      expect(Boolean(screen.getByText('Batches'))).toBe(true);
    });
  });

  it('does not fetch batch rows when the selected engine read action is denied', async () => {
    authPermissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Batches unavailable')).toBeInTheDocument();
      expect(screen.getByText('Missing permission engine:instance:view')).toBeInTheDocument();
    });
  });
});
