import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitVersionsPanel from '@src/features/git/components/GitVersionsPanel';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    toTenantPath: (path: string) => path,
    tenantSlug: 'default',
    effectivePathname: '/',
    navigate: vi.fn(),
  }),
}));

vi.mock('@src/features/shared/components/LoadingState', () => ({
  LoadingState: ({ message = 'Loading...' }: { message?: string }) => <div>{message}</div>,
}));

vi.mock('@src/features/shared/components/Viewer', () => ({
  default: () => <div>Viewer</div>,
}));

vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({
  default: () => <div>DMNDrdMini</div>,
}));

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  Button: ({ children, onClick, ...props }: any) => <button onClick={onClick} {...props}>{children}</button>,
  InlineNotification: ({ title, subtitle }: any) => <div>{title}{subtitle ? ` ${subtitle}` : ''}</div>,
  ProgressIndicator: ({ children }: any) => <div>{children}</div>,
  ProgressStep: ({ label, secondaryLabel }: any) => (
    <div data-testid="progress-step">
      <div>{label}</div>
      {secondaryLabel ? <div>{secondaryLabel}</div> : null}
    </div>
  ),
  Toggle: ({ id, toggled, onToggle }: any) => (
    <label htmlFor={id}>
      Show system versions
      <input
        id={id}
        type="checkbox"
        aria-label="Show system versions"
        checked={Boolean(toggled)}
        onChange={() => onToggle?.(!toggled)}
      />
    </label>
  ),
  Dropdown: () => <div />,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('GitVersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [];
      if (url === '/starbase-api/files/file-1/versions') {
        return [
          {
            id: 'initial-import',
            author: 'system',
            message: 'Initial import',
            createdAt: 1700000000,
          },
        ];
      }
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
            {
              id: 'manual-legacy',
              branchId: 'main-1',
              message: 'Legacy version',
              userId: 'user-1',
              createdAt: 1700000000000,
              hash: 'hash-legacy',
              versionNumber: 12,
              source: 'manual',
              isRemote: true,
            },
            {
              id: 'system-1',
              branchId: 'main-1',
              message: 'Nightly baseline',
              userId: 'user-1',
              createdAt: 1700000000150,
              hash: 'hash-system',
              source: 'system',
              isRemote: true,
            },
            {
              id: 'auto-sync',
              branchId: 'main-1',
              message: 'Sync from Starbase draft',
              userId: 'user-1',
              createdAt: 1700000000200,
              hash: 'hash-auto',
              source: 'system',
              isRemote: true,
            },
          ],
        };
      }
      return [];
    });
    (apiClient.post as any).mockResolvedValue({});
  });

  function renderPanel() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <GitVersionsPanel
          projectId="project-1"
          fileId="file-1"
          fileName="Invoice"
          fileType="bpmn"
        />
      </QueryClientProvider>
    );
  }

  function renderLocalPanel() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <GitVersionsPanel
          projectId="project-1"
          fileId="file-1"
          fileName="Invoice"
          fileType="bpmn"
          saveMode="local"
        />
      </QueryClientProvider>
    );
  }

  it('hides system versions by default while preserving file-version and project-version labels', async () => {
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/v7.*Save Invoice/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/v12.*Legacy version/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nightly baseline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sync from Starbase draft/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Show system versions \(1\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /show system versions/i }));

    await waitFor(() => {
      expect(screen.getByText(/Nightly baseline/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.queryByText(/Sync from Starbase draft/i)).not.toBeInTheDocument();
  });

  it('reuses the versions empty state in local mode while filtering the seeded initial import row', async () => {
    renderLocalPanel();

    await waitFor(() => {
      expect(screen.getByText(/No versions yet\. Save a version to start tracking changes\./i)).toBeInTheDocument();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/starbase-api/files/file-1/versions');
    expect(screen.queryByText(/Initial import/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Show system versions/i)).not.toBeInTheDocument();
  });
});
