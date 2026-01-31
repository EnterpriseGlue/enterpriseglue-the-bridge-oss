import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      syncBothEnabled: false,
      gitProjectTokenSharingEnabled: true,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/starbase']}>
        <ProjectOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectOverview error state', () => {
  it('shows error state when API fails', async () => {
    server.use(
      http.get('/starbase-api/projects', () => HttpResponse.json({ error: 'fail' }, { status: 500 })),
      http.get('/t/default/starbase-api/projects', () => HttpResponse.json({ error: 'fail' }, { status: 500 }))
    );

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    });
  });
});
