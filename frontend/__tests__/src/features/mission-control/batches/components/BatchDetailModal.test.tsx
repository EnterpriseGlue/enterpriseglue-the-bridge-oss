import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BatchDetailModal from '@src/features/mission-control/batches/components/BatchDetailModal';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({
    data: {
      batch: {
        id: 'batch-1',
        camundaBatchId: 'camunda-batch-1',
        status: 'RUNNING',
        progress: 25,
        type: 'DELETE_INSTANCES',
        suspended: false,
      },
      engine: {},
      statistics: {},
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock('@carbon/react', () => ({
  ComposedModal: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  ModalHeader: ({ label, title }: any) => (
    <header>
      <div>{label}</div>
      <h2>{title}</h2>
    </header>
  ),
  ModalBody: ({ children }: any) => <div>{children}</div>,
  ModalFooter: ({ children }: any) => <footer>{children}</footer>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  InlineLoading: ({ description }: any) => <span>{description}</span>,
  ProgressBar: ({ label }: any) => <div>{label}</div>,
}));

const deniedAuthContext: AuthContextValue = {
  user: null,
  permissions: {
    userId: 'user-1',
    tenantId: null,
    platform: [],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'], runtimePermissions: [] }],
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
};

describe('BatchDetailModal', () => {
  it('exports BatchDetailModal component', () => {
    expect(BatchDetailModal).toBeDefined();
    expect(typeof BatchDetailModal).toBe('function');
  });

  it('disables pause and cancel actions when permissions are missing', () => {
    render(
      <AuthContext.Provider value={deniedAuthContext}>
        <BatchDetailModal open batchId="batch-1" onClose={vi.fn()} />
      </AuthContext.Provider>
    );

    const pause = screen.getByRole('button', { name: /Pause batch/i });
    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute('title', 'Action decision unavailable for this runtime resource');

    const cancel = screen.getByRole('button', { name: /Cancel batch/i });
    expect(cancel).toBeDisabled();
    expect(cancel).toHaveAttribute('title', 'Action decision unavailable for this runtime resource');
  });
});
