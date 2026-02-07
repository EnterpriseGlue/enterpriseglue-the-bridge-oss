import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import { apiClient } from '@src/shared/api/client';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: true,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

vi.mock('@src/features/git/components', () => ({
  CreateOnlineProjectModal: ({ open }: { open: boolean }) =>
    open ? <h2>Create Project</h2> : null,
}));

vi.mock('@src/features/starbase/components/project-detail/EngineAccessModal', () => ({
  EngineAccessModal: () => null,
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

describe('ProjectOverview actions', () => {
  let projectName = 'Alpha Project';

  beforeEach(() => {
    projectName = 'Alpha Project';
    server.use(
      http.get('/starbase-api/projects', () => {
        return HttpResponse.json([
          {
            id: 'project-1',
            name: projectName,
            createdAt: Date.now(),
            foldersCount: 0,
            filesCount: 0,
            gitUrl: null,
            gitProviderType: null,
            gitSyncStatus: null,
            members: [],
          },
        ]);
      }),
      http.get('/t/default/starbase-api/projects', () => {
        return HttpResponse.json([
          {
            id: 'project-1',
            name: projectName,
            createdAt: Date.now(),
            foldersCount: 0,
            filesCount: 0,
            gitUrl: null,
            gitProviderType: null,
            gitSyncStatus: null,
            members: [],
          },
        ]);
      }),
      http.patch('/starbase-api/projects/:projectId', async ({ request }) => {
        const body = (await request.json()) as { name?: string };
        if (body?.name) {
          projectName = body.name;
        }
        return HttpResponse.json({ id: 'project-1', name: projectName });
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens create project modal from toolbar', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(Boolean(screen.getByText('Alpha Project'))).toBe(true);
    });

    const newButton = screen.getByRole('button', { name: /new project/i });
    await userEvent.click(newButton);

    expect(Boolean(screen.getByRole('heading', { name: /create project/i }))).toBe(true);
  });

  it('renames a project via inline edit', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(Boolean(screen.getByText('Alpha Project'))).toBe(true);
    });

    const overflowButton = screen.getByRole('button', { name: /options/i });
    await userEvent.click(overflowButton);

    const renameOption = await screen.findByText('Rename');
    await userEvent.click(renameOption);

    const nameInput = screen.getByDisplayValue('Alpha Project');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Project{enter}');

    await waitFor(() => {
      expect(Boolean(screen.queryByDisplayValue('Renamed Project'))).toBe(false);
    });
  });

  it('downloads a project from the overflow menu', async () => {
    const getBlobSpy = vi.spyOn(apiClient, 'getBlob').mockResolvedValue(new Blob(['zip']));
    (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (globalThis.URL as any).revokeObjectURL = vi.fn();
    renderWithProviders();

    await waitFor(() => {
      expect(Boolean(screen.getByText('Alpha Project'))).toBe(true);
    });

    const overflowButton = screen.getByRole('button', { name: /options/i });
    await userEvent.click(overflowButton);

    const downloadOption = await screen.findByText('Download');
    await userEvent.click(downloadOption);

    await waitFor(() => {
      expect(getBlobSpy).toHaveBeenCalledWith('/starbase-api/projects/project-1/download');
    });
  });
});
