import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import Decisions from '@src/features/mission-control/decisions-overview/components/Decisions';
import { AuthContext } from '@src/contexts/AuthContext';
import { useDecisionsFilterStore } from '@src/features/mission-control/shared/stores/decisionsFilterStore';
import { listDecisionDefinitions, fetchDecisionDefinitionDmnXml, listDecisionHistory } from '@src/features/mission-control/decisions-overview/api/decisions';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/components/EngineSelector', () => ({ useSelectedEngine: () => 'engine-1' }));
vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@src/features/mission-control/decisions-overview/api/decisions', async original => ({ ...await original<typeof import('@src/features/mission-control/decisions-overview/api/decisions')>(), listDecisionDefinitions: vi.fn(), fetchDecisionDefinitionDmnXml: vi.fn(), listDecisionHistory: vi.fn() }));
vi.mock('@src/features/mission-control/decisions-overview/components/DecisionsDataTable', () => ({ DecisionsDataTable: () => <div>History table</div> }));
vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({ default: ({ xml }: { xml: string }) => <pre>{xml}</pre> }));
vi.mock('@src/shared/components/PageLoader', () => ({ PageLoader: ({ children }: any) => <>{children}</> }));
vi.mock('react-split-pane', () => ({ SplitPane: ({ children }: any) => <div>{children}</div>, Pane: ({ children }: any) => <div>{children}</div> }));
const defs = [{ id: 'warm:8:def', key: 'warm', name: 'Warm', version: 8, decisionRequirementsDefinitionId: 'warm:8:drd', decisionRequirementsDefinitionKey: 'warm-drd' },
  ...[3, 4].map(version => ({ id: `target:${version}:def`, key: 'target', name: 'Target', version, decisionRequirementsDefinitionId: `target:${version}:drd`, decisionRequirementsDefinitionKey: 'target-drd' }))];
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function fixture(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const auth = { user: { id: 'reader' }, isAuthenticated: true, isLoading: false, sessionRevision: 1,
    permissions: { userId: 'reader', platform: [], projects: [], engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }], generatedAt: 1 } } as any;
  return render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={['/t/tenant-a/mission-control/decisions?' + search]}><Location /><Decisions /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useDecisionsFilterStore.getState().reset();
  useDecisionsFilterStore.setState({ selectedDefinition: { id: 'warm:8:def', label: 'Warm', key: 'warm', version: 8 }, selectedVersion: 8 });
  vi.mocked(listDecisionDefinitions).mockResolvedValue(defs as any);
  vi.mocked(fetchDecisionDefinitionDmnXml).mockImplementation(async id => `xml:${id}`);
  vi.mocked(listDecisionHistory).mockResolvedValue([]);
  vi.mocked(apiClient.get).mockResolvedValue({ canShowEditButton: false, canEdit: false, engineId: 'engine-1', projectId: 'project-1', fileId: '', decisionKey: 'target', decisionVersion: 3 });
});

it('applies an exact key/version link atomically over a different persisted selection', async () => {
  fixture('engineId=engine-1&decision=target&version=3');
  await waitFor(() => expect(useDecisionsFilterStore.getState().selectedDefinition?.key).toBe('target'));
  await waitFor(() => expect(useDecisionsFilterStore.getState().selectedVersion).toBe(3));
  await waitFor(() => expect(fetchDecisionDefinitionDmnXml).toHaveBeenCalledWith('target:3:def', 'engine-1'));
  expect(vi.mocked(fetchDecisionDefinitionDmnXml).mock.calls.every(([id]) => id === 'target:3:def')).toBe(true);
  expect(vi.mocked(listDecisionHistory).mock.calls.every(([params]) => params?.get('decisionRequirementsDefinitionId') === 'target:3:drd')).toBe(true);
  expect(screen.getByTestId('location')).toHaveTextContent('?engineId=engine-1');
});

it.each(['99', '3.5'])('does not replace an unavailable or invalid linked version %s with the latest', async version => {
  fixture(`engineId=engine-1&decision=target&version=${version}`);
  expect(await screen.findByText('Linked definition unavailable')).toBeVisible();
  expect(fetchDecisionDefinitionDmnXml).not.toHaveBeenCalled(); expect(listDecisionHistory).not.toHaveBeenCalled(); expect(apiClient.get).not.toHaveBeenCalled();
  expect(screen.getByTestId('location')).toHaveTextContent('version=' + version);
});

it('waits for definitions before issuing any linked-resource read', async () => {
  let settle!: (value: any) => void; vi.mocked(listDecisionDefinitions).mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  fixture('engineId=engine-1&decision=target&version=3');
  await waitFor(() => expect(listDecisionDefinitions).toHaveBeenCalledOnce());
  expect(fetchDecisionDefinitionDmnXml).not.toHaveBeenCalled(); expect(listDecisionHistory).not.toHaveBeenCalled(); expect(apiClient.get).not.toHaveBeenCalled();
  await act(async () => settle(defs));
  await waitFor(() => expect(fetchDecisionDefinitionDmnXml).toHaveBeenCalledWith('target:3:def', 'engine-1'));
});
