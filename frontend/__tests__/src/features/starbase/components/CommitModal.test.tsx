import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommitModal from '@src/features/starbase/components/CommitModal';
import { apiClient } from '@src/shared/api/client';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, modalHeading, primaryButtonText, secondaryButtonText, onRequestSubmit, onRequestClose, primaryButtonDisabled, children }: any) => {
    if (!open) return null;
    return (
      <div>
        <h2>{modalHeading}</h2>
        {children}
        <button onClick={onRequestSubmit} disabled={primaryButtonDisabled}>{primaryButtonText}</button>
        <button onClick={onRequestClose}>{secondaryButtonText}</button>
      </div>
    );
  },
  TextArea: ({ id, labelText, value, onChange, placeholder, disabled }: any) => (
    <label htmlFor={id}>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />
    </label>
  ),
  InlineLoading: ({ description }: { description: string }) => <div>{description}</div>,
}));

vi.mock('@src/shared/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(message: string, status = 500, data?: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  apiClient: {
    post: vi.fn(),
  },
}));

describe('CommitModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.post as any).mockResolvedValue({});
  });

  function renderModal(props: Partial<React.ComponentProps<typeof CommitModal>> = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    return {
      invalidateQueriesSpy,
      ...render(
        <QueryClientProvider client={queryClient}>
          <CommitModal
            open
            onClose={vi.fn()}
            projectId="project-1"
            fileId="file-1"
            {...props}
          />
        </QueryClientProvider>
      ),
    };
  }

  it('posts to the VCS commit endpoint in git mode', async () => {
    const user = userEvent.setup();
    renderModal({ saveMode: 'git' });

    await user.type(screen.getByLabelText(/version description/i), 'Git save');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/vcs-api/projects/project-1/commit', {
        message: 'Git save',
        fileIds: ['file-1'],
      });
    });
  });

  it('posts to the local versions endpoint in local mode', async () => {
    const user = userEvent.setup();
    const { invalidateQueriesSpy } = renderModal({ saveMode: 'local' });

    await user.type(screen.getByLabelText(/version description/i), 'Local save');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/files/file-1/versions', {
        message: 'Local save',
      });
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['versions', 'file-1'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['versions-panel', 'local', 'project-1', 'file-1'] });
  });
});
