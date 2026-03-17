import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VersionsPanel from '@src/features/starbase/components/VersionsPanel';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('VersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <VersionsPanel fileId="file-1" />
      </QueryClientProvider>
    );
  }

  it('renders local file versions from the file-scoped endpoint', async () => {
    (apiClient.get as any).mockResolvedValue([
      { id: 'v-1', author: 'user-1', message: 'Saved locally', createdAt: 1700000010 },
    ]);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/Saved locally/i)).toBeInTheDocument();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/starbase-api/files/file-1/versions');
  });
});
