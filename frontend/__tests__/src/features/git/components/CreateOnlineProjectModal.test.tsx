import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import CreateOnlineProjectModal from '@src/features/git/components/CreateOnlineProjectModal';

const hookMocks = vi.hoisted(() => ({
  wizard: null as any,
}));

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, primaryButtonText, primaryButtonDisabled }: any) => open ? (
    <div>
      {children}
      <button disabled={Boolean(primaryButtonDisabled)}>{primaryButtonText}</button>
    </div>
  ) : null,
  TextInput: ({ id, labelText, value, onChange, invalidText }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input id={id} value={value || ''} onChange={onChange} />
      {invalidText ? <span>{invalidText}</span> : null}
    </label>
  ),
  Select: ({ id, labelText, value, onChange, children, invalidText }: any) => (
    <label htmlFor={id}>
      {labelText}
      <select id={id} value={value || ''} onChange={onChange}>{children}</select>
      {invalidText ? <span>{invalidText}</span> : null}
    </label>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  InlineNotification: ({ title, subtitle }: any) => (
    <div>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  ),
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  Toggle: ({ id, labelText, toggled, onToggle }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input id={id} type="checkbox" checked={Boolean(toggled)} onChange={() => onToggle?.(!toggled)} />
    </label>
  ),
}));

vi.mock('@src/features/git/hooks/useOnlineProjectWizard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/features/git/hooks/useOnlineProjectWizard')>();
  return {
    ...actual,
    useOnlineProjectWizard: () => hookMocks.wizard,
  };
});

vi.mock('@src/features/git/components/CreateOnlineProjectExistingConnectionPanel', () => ({
  CreateOnlineProjectExistingConnectionPanel: () => <div>Existing connection</div>,
}));

vi.mock('@src/features/git/components/CreateOnlineProjectAuthSection', () => ({
  CreateOnlineProjectAuthSection: () => <div>Auth section</div>,
}));

vi.mock('@src/features/git/components/CreateOnlineProjectRepoModeFields', () => ({
  CreateOnlineProjectRepoModeFields: () => <div>Repo mode</div>,
}));

describe('CreateOnlineProjectModal', () => {
  beforeEach(() => {
    hookMocks.wizard = {
      navigate: vi.fn(),
      toTenantPath: (path: string) => path,
      isExistingProject: false,
      isEditConnectedProject: false,
      existingRepo: null,
      projectName: 'Imported project',
      setProjectName: vi.fn(),
      importFromEngine: true,
      setImportFromEngine: vi.fn(),
      selectedImportEngineId: 'engine-1',
      setSelectedImportEngineId: vi.fn(),
      importableEngines: [{ id: 'engine-1', name: 'Dev Engine', role: 'deployer' }],
      importableEnginesQuery: { isLoading: false },
      importPreviewQuery: {
        isLoading: false,
        isError: false,
        data: {
          engineId: 'engine-1',
          allowed: true,
          targetAction: 'create_import_target',
          counts: { bpmn: 2, dmn: 1 },
          files: [
            { name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'order', dmnDecisionId: null },
          ],
          warnings: [],
        },
      },
      importPreviewErrorMessage: null,
      canImportFromEngine: true,
      connectToGit: false,
      setConnectToGit: vi.fn(),
      repoMode: null,
      setRepoMode: vi.fn(),
      providerId: '',
      setProviderId: vi.fn(),
      namespace: '',
      setNamespace: vi.fn(),
      repositoryName: '',
      setRepositoryName: vi.fn(),
      description: '',
      setDescription: vi.fn(),
      isPrivate: true,
      setIsPrivate: vi.fn(),
      existingRepos: [],
      loadingRepos: false,
      repoFetchError: null,
      selectedExistingRepoUrl: '',
      setSelectedExistingRepoUrl: vi.fn(),
      customRepoUrl: '',
      setCustomRepoUrl: vi.fn(),
      conflictStrategy: 'preferRemote',
      setConflictStrategy: vi.fn(),
      connectionMode: 'select',
      setConnectionMode: vi.fn(),
      selectedCredentialId: '',
      authMethod: 'pat',
      setAuthMethod: vi.fn(),
      token: '',
      setToken: vi.fn(),
      connectionName: '',
      setConnectionName: vi.fn(),
      connectionStatus: 'disconnected',
      connectedUser: null,
      connectionError: null,
      existingCredentials: [],
      namespaces: [],
      loadingNamespaces: false,
      fieldErrors: {},
      setFieldErrors: vi.fn(),
      generalError: null,
      providersQuery: { data: [], isLoading: false },
      selectedProvider: null,
      handleSelectCredential: vi.fn(),
      connectWithPAT: vi.fn(),
      connectWithOAuth: vi.fn(),
      handleClose: vi.fn(),
      handleSubmit: vi.fn(),
      generateRemoteUrl: vi.fn(() => ''),
      isConnected: false,
      isValid: true,
      isLoading: false,
      createMutation: { isPending: false },
      initExistingMutation: { isPending: false },
      createLocalMutation: { isPending: false },
      cloneExistingMutation: { isPending: false },
      cloneNewProjectMutation: { isPending: false },
    };
  });

  it('exports CreateOnlineProjectModal component', () => {
    expect(CreateOnlineProjectModal).toBeDefined();
    expect(typeof CreateOnlineProjectModal).toBe('function');
  });

  it('renders selected engine import preview counts', () => {
    render(<CreateOnlineProjectModal open onClose={vi.fn()} />);

    expect(screen.getByText('Import preview ready')).toBeInTheDocument();
    expect(screen.getByText('2 BPMN and 1 DMN definitions found. The project-engine import target will be created.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Project' })).not.toBeDisabled();
  });
});
