import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decisions from '@src/features/mission-control/decisions-overview/components/Decisions';
import { apiClient } from '@src/shared/api/client';
import {
  fetchDecisionDefinitionDmnXml,
  listDecisionDefinitions,
  listDecisionHistory,
} from '@src/features/mission-control/decisions-overview/api/decisions';

const setSelectedDefinition = vi.fn();
const setSelectedVersion = vi.fn();
const setSelectedStates = vi.fn();
const reset = vi.fn();
const setSelectedEngineId = vi.fn();

const decisionDefinitions = [
  {
    id: 'invoiceClassification:8:def-8',
    key: 'invoiceClassification',
    name: 'Invoice Classification',
    version: 8,
    decisionRequirementsDefinitionId: 'invoiceBusinessDecisions:8:drd-8',
    decisionRequirementsDefinitionKey: 'invoiceBusinessDecisions',
  },
  {
    id: 'invoiceClassification:9:def-9',
    key: 'invoiceClassification',
    name: 'Invoice Classification',
    version: 9,
    decisionRequirementsDefinitionId: 'invoiceBusinessDecisions:9:drd-9',
    decisionRequirementsDefinitionKey: 'invoiceBusinessDecisions',
  },
] as const;

const filterStoreState = {
  selectedDefinition: null as { id: string; label: string; key: string; version: number } | null,
  selectedVersion: null as number | null,
  selectedStates: [] as Array<{ id: string; label: string }>,
  searchValue: '',
  dateFrom: '',
  dateTo: '',
  timeFrom: '',
  timeTo: '',
  setSelectedDefinition,
  setSelectedVersion,
  setSelectedStates,
  reset,
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ state: null }),
}));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    toTenantPath: (p: string) => p,
    tenantSlug: 'default',
    effectivePathname: '/',
    navigate: vi.fn(),
  }),
}));

vi.mock('@src/features/mission-control/shared/stores/decisionsFilterStore', () => ({
  useDecisionsFilterStore: () => filterStoreState,
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/stores/engineSelectorStore', () => ({
  useEngineSelectorStore: (selector: any) =>
    selector({
      selectedEngineId: 'engine-1',
      setSelectedEngineId,
    }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/features/mission-control/decisions-overview/api/decisions', async () => {
  const actual = await vi.importActual<typeof import('@src/features/mission-control/decisions-overview/api/decisions')>(
    '@src/features/mission-control/decisions-overview/api/decisions'
  );
  return {
    ...actual,
    listDecisionDefinitions: vi.fn(),
    fetchDecisionDefinitionDmnXml: vi.fn(),
    listDecisionHistory: vi.fn(),
  };
});

vi.mock('react-split-pane', () => ({
  SplitPane: ({ children }: any) => <div>{children}</div>,
  Pane: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/features/mission-control/decisions-overview/components/DecisionsDataTable', () => ({
  DecisionsDataTable: () => <div>Decisions table</div>,
}));

vi.mock('@src/shared/components/PageLoader', () => ({
  PageLoader: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({
  default: () => <div>DMN</div>,
}));

vi.mock('@src/features/shared/components/LoadingState', () => ({
  LoadingState: ({ message }: any) => <div>{message}</div>,
}));

function renderDecisions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Decisions />
    </QueryClientProvider>
  );
}

function getLastHistoryQueryParams() {
  const calls = vi.mocked(listDecisionHistory).mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall?.[0] as URLSearchParams | undefined;
}

describe('Decisions component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filterStoreState.selectedDefinition = null;
    filterStoreState.selectedVersion = null;
    filterStoreState.selectedStates = [];
    vi.mocked(listDecisionDefinitions).mockResolvedValue([...decisionDefinitions] as any);
    vi.mocked(listDecisionHistory).mockResolvedValue([]);
    vi.mocked(fetchDecisionDefinitionDmnXml).mockResolvedValue('<definitions />');
    vi.mocked(apiClient.get).mockResolvedValue({
      canShowEditButton: false,
      canEdit: false,
      engineId: 'engine-1',
      decisionKey: 'invoiceClassification',
      decisionVersion: 9,
      projectId: 'project-1',
      fileId: '',
    } as any);
  });

  it('renders empty decision selection prompt', () => {
    vi.mocked(listDecisionDefinitions).mockResolvedValue([]);

    renderDecisions();

    expect(screen.getByText('To view a Decision Table, select a Decision in the Filters panel')).toBeInTheDocument();
  });

  it('queries history by decision requirements key for all versions', async () => {
    filterStoreState.selectedDefinition = {
      id: 'invoiceClassification:9:def-9',
      label: 'Invoice Classification',
      key: 'invoiceClassification',
      version: 9,
    };
    filterStoreState.selectedVersion = null;

    renderDecisions();

    await waitFor(() => {
      const params = getLastHistoryQueryParams();
      expect(params?.get('decisionRequirementsDefinitionKey')).toBe('invoiceBusinessDecisions');
    });

    const params = getLastHistoryQueryParams() as URLSearchParams;
    expect(params.get('decisionRequirementsDefinitionId')).toBeNull();
    expect(params.get('decisionDefinitionKey')).toBeNull();
    expect(params.get('decisionDefinitionId')).toBeNull();
    expect(params.get('rootDecisionInstancesOnly')).toBe('true');
  });

  it('queries history by decision requirements id for a specific version', async () => {
    filterStoreState.selectedDefinition = {
      id: 'invoiceClassification:9:def-9',
      label: 'Invoice Classification',
      key: 'invoiceClassification',
      version: 9,
    };
    filterStoreState.selectedVersion = 9;

    renderDecisions();

    await waitFor(() => {
      const params = getLastHistoryQueryParams();
      expect(params?.get('decisionRequirementsDefinitionId')).toBe('invoiceBusinessDecisions:9:drd-9');
    });

    const params = getLastHistoryQueryParams() as URLSearchParams;
    expect(params.get('decisionRequirementsDefinitionKey')).toBeNull();
    expect(params.get('decisionDefinitionKey')).toBeNull();
    expect(params.get('decisionDefinitionId')).toBeNull();
    expect(params.get('rootDecisionInstancesOnly')).toBe('true');
  });
});
