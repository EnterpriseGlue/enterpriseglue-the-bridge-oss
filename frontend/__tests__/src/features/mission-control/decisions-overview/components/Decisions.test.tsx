import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decisions from '@src/features/mission-control/decisions-overview/components/Decisions';
import { apiClient } from '@src/shared/api/client';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
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
let authPermissions: any;

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

const navigation = vi.hoisted(() => ({ go: vi.fn() }));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: navigation.go,
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

  const tree = () => (
    <AuthContext.Provider value={{
      user: null,
      permissions: authPermissions,
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
    } satisfies AuthContextValue}>
      <QueryClientProvider client={queryClient}>
        <Decisions />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
  const view = render(tree());
  return { ...view, rerenderCurrent: () => view.rerender(tree()), queryClient };
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
    authPermissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
      generatedAt: 1,
    };
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

  function editableVersion() {
    filterStoreState.selectedDefinition = { id: decisionDefinitions[0].id, label: 'Invoice Classification', key: 'invoiceClassification', version: 8 };
    filterStoreState.selectedVersion = 8;
    const target = { canShowEditButton: true, canEdit: true, engineId: 'engine-1', decisionKey: 'invoiceClassification', decisionVersion: 8, projectId: 'project-1', fileId: 'file-1', engineDeploymentId: 'deployment-8', commitId: 'commit-8', fileVersionNumber: 2, mappingSource: 'git-commit' };
    vi.mocked(apiClient.get).mockResolvedValue(target); return target;
  }
  const allowance = (body: any) => ({ allowed: true, reasonCode: 'allowed', reason: 'Allowed', missingActions: [], projectId: body.projectId, fileId: body.fileId, engineId: body.engineId, targetId: 'target-1', lineage: { kind: body.kind, definitionId: body.definitionId, definitionKey: body.definitionKey, decisionDefinitionId: body.decisionDefinitionId, decisionDefinitionKey: body.decisionDefinitionKey } });
  it.each(['version', 'version-aba'])('does not navigate from a pending edit check after %s changes on the same engine', async change => {
    editableVersion(); let finish!: () => void;
    vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise(resolve => { finish = () => resolve(allowance(body)); }));
    const f = renderDecisions(); const edit = await screen.findByRole('button', { name: /^Edit$/ }); await waitFor(() => expect(edit).toBeEnabled()); await userEvent.click(edit);
    filterStoreState.selectedVersion = 9; f.rerenderCurrent(); if (change === 'version-aba') { filterStoreState.selectedVersion = 8; f.rerenderCurrent(); }
    await act(async () => finish()); expect(navigation.go).not.toHaveBeenCalled();
  });
  it('keeps a detached edit target when query metadata changes during the bridge check', async () => {
    const target = editableVersion(); let finish!: () => void;
    vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise(resolve => { finish = () => resolve(allowance(body)); }));
    renderDecisions(); const edit = await screen.findByRole('button', { name: /^Edit$/ }); await waitFor(() => expect(edit).toBeEnabled()); await userEvent.click(edit);
    target.fileId = 'foreign-file'; target.commitId = 'foreign-commit'; await act(async () => finish());
    expect(navigation.go).toHaveBeenCalledOnce(); const url = String(navigation.go.mock.calls[0][0]); expect(url).toContain('/starbase/editor/file-1?'); expect(url).toContain('commitId=commit-8'); expect(url).not.toContain('foreign');
  });

  it('renders empty decision selection prompt and scoped visibility explanation', async () => {
    vi.mocked(listDecisionDefinitions).mockResolvedValue([]);

    renderDecisions();

    expect(screen.getByText('To view a Decision Table, select a Decision in the Filters panel')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('No visible decision definitions')).toBeInTheDocument();
    });
  });

  it('does not fetch decision definitions when the selected engine read action is denied', () => {
    authPermissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderDecisions();

    expect(screen.getByText('Decision definitions unavailable')).toBeInTheDocument();
    expect(screen.getByText('Missing permission engine:instance:view')).toBeInTheDocument();
    expect(listDecisionDefinitions).not.toHaveBeenCalled();
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
