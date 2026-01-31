import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';

vi.mock('../../platform-admin/hooks/usePlatformSyncSettings', () => ({
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
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/starbase']}>
        <ProjectOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectOverview', () => {
  it('renders projects from the API', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    });
  });
});
