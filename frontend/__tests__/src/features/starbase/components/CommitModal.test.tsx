import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommitModal from '@src/features/starbase/components/CommitModal';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { commitBodySchema } from '@enterpriseglue/shared/schemas/starbase/commit.js';
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
  InlineNotification: ({ title, subtitle }: any) => <div role="alert">{title}: {subtitle}</div>,
}));

vi.mock('@src/shared/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@src/shared/api/client')>(),
  apiClient: {
    post: vi.fn(),
  },
}));

const authMocks = vi.hoisted(() => ({ allowed: true, revision: 0 }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    sessionRevision: authMocks.revision,
    permissions: {
      userId: 'user-1',
      platform: [],
      projects: [
        {
          projectId: 'project-1',
          permissions: ['project:versions:create', 'project:git:commit'],
        },
      ],
      engines: [],
      generatedAt: 1,
    },
    hasProjectPermission: () => authMocks.allowed,
  }),
}));

describe('CommitModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.allowed = true; authMocks.revision = 0;
    (apiClient.post as any).mockResolvedValue({ commitId: 'verified-commit' });
  });

  function renderModal(props: Partial<React.ComponentProps<typeof CommitModal>> = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const modal = (next: Partial<React.ComponentProps<typeof CommitModal>> = {}) => <QueryClientProvider client={queryClient}><CommitModal open onClose={vi.fn()} projectId="project-1" fileId="file-1" {...props} {...next} /></QueryClientProvider>;
    return {
      invalidateQueriesSpy, modal, queryClient,
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

  it('does not save after the modal changes project and returns during preparation', async () => {
    let finish!: () => void;
    const beforeSubmit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const fixture = renderModal({ beforeSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(beforeSubmit).toHaveBeenCalledTimes(1));
    fixture.rerender(fixture.modal({ projectId: 'project-2' }));
    fixture.rerender(fixture.modal());
    await act(async () => { finish(); });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each(['file', 'mode', 'closed', 'session', 'permission', 'cancel', 'unmount'])('stops preparation after %s changes', async change => {
    let finish!: () => void;
    const beforeSubmit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn(), onSuccess = vi.fn();
    const fixture = renderModal({ beforeSubmit, onClose, onSuccess });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(beforeSubmit).toHaveBeenCalledTimes(1));
    if (change === 'file') fixture.rerender(fixture.modal({ fileId: 'file-2' }));
    if (change === 'mode') fixture.rerender(fixture.modal({ saveMode: 'local' }));
    if (change === 'closed') fixture.rerender(fixture.modal({ open: false }));
    if (change === 'session') advanceBrowserSessionRevision();
    if (change === 'permission') { authMocks.allowed = false; authMocks.revision++; fixture.rerender(fixture.modal()); }
    if (change === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    if (change === 'unmount') fixture.unmount();
    await act(async () => { finish(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    if (change === 'cancel') expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('suppresses stale save completion after the view is replaced', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onSuccess = vi.fn(), onClose = vi.fn();
    const fixture = renderModal({ onSuccess, onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fixture.rerender(fixture.modal({ fileId: 'file-2' }));
    await act(async () => { finish({ commitId: 'old-completion' }); });
    expect(onSuccess).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(fixture.invalidateQueriesSpy).not.toHaveBeenCalled();
  });

  it.each(['git', 'local'] as const)('rejects an unverified %s save acknowledgement', async saveMode => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const onSuccess = vi.fn(), onClose = vi.fn();
    renderModal({ saveMode, onSuccess, onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Saved version was not verified')).toBeVisible();
    expect(onSuccess).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a full-project save unscoped and validates the exact request contract', async () => {
    renderModal({ fileId: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    const body = vi.mocked(apiClient.post).mock.calls[0][1];
    expect(body).toEqual({ message: 'Version' }); expect(commitBodySchema.parse(body)).toEqual(body);
  });

  it('validates a selected file request with real UUIDs against the backend schema', async () => {
    const fileId = '22222222-2222-4222-8222-222222222222';
    renderModal({ fileId });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    const body = vi.mocked(apiClient.post).mock.calls[0][1];
    expect(body).toEqual({ message: 'Version', fileIds: [fileId] }); expect(commitBodySchema.parse(body)).toEqual(body);
  });

  it('refuses an empty file scope before preparing or posting', async () => {
    const beforeSubmit = vi.fn(); renderModal({ fileId: '', beforeSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Missing fileId for file version save')).toBeVisible();
    expect(beforeSubmit).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled();
  });

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
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'verified-local-version' });
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
