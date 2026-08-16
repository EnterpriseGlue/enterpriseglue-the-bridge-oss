import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import BatchesPage from '@src/features/mission-control/batches/BatchesPage';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';
import { AuthContext } from '@src/contexts/AuthContext';

const authContextValue = {
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
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  resetPassword: () => Promise.resolve(),
  changePassword: () => Promise.resolve(),
  refreshUser: () => Promise.resolve(),
  setAuthenticatedUser: () => {},
  refreshPermissions: () => Promise.resolve(),
  hasPlatformPermission: () => false,
  hasAnyPlatformPermission: () => false,
  hasProjectPermission: () => false,
  hasAnyProjectPermission: () => false,
  hasEnginePermission: () => true,
  hasAnyEnginePermission: () => true,
  hasAnyScopedEnginePermission: () => true,
} as any;

function renderWithProviders() {
  useEngineSelectorStore.setState({ selectedEngineId: 'engine-1' });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={authContextValue}>
        <MemoryRouter initialEntries={['/mission-control/batches']}>
          <Routes>
            <Route path="/mission-control/batches" element={<BatchesPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('BatchesList error state', () => {
  it('shows error notification when API fails', async () => {
    server.use(
      http.get(/\/mission-control-api\/batches(?:\?.*)?$/, () => HttpResponse.json({ error: 'fail' }, { status: 500 }))
    );

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Failed to load batches')).toBeInTheDocument();
    });
  });
});
