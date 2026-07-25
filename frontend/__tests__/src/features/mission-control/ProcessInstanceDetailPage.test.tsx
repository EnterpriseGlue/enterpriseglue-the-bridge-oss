import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessInstanceDetailPage from '@src/features/mission-control/process-instance-detail/ProcessInstanceDetailPage';

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', pathname: '/mission-control/processes' }),
}));

vi.mock('@src/features/mission-control/shared/stores/processesFilterStore', () => ({
  useProcessesFilterStore: () => ({ selectedProcess: null, selectedVersion: null }),
}));

vi.mock('@src/shared/hooks/useAlert', () => ({
  useAlert: () => ({ alertState: null, showAlert: vi.fn(), closeAlert: vi.fn() }),
}));

describe('ProcessInstanceDetailPage', () => {
  it('renders not found state when instanceId is missing', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProcessInstanceDetailPage />
      </QueryClientProvider>
    );
    expect(screen.getByText('Instance not found')).toBeInTheDocument();
    expect(screen.getByText('No instance ID provided')).toBeInTheDocument();
  });
});
