import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CreateOnlineProjectRepoModeFields } from '@src/features/git/components/CreateOnlineProjectRepoModeFields';

describe('CreateOnlineProjectRepoModeFields', () => {
  it('exports CreateOnlineProjectRepoModeFields component', () => {
    expect(CreateOnlineProjectRepoModeFields).toBeDefined();
    expect(typeof CreateOnlineProjectRepoModeFields).toBe('function');
  });

  it('shows a dedicated unavailable state when repository inspection is denied', () => {
    render(
      <CreateOnlineProjectRepoModeFields
        repoMode="existing"
        setRepoMode={() => undefined}
        isConnected
        namespaces={[]}
        namespace=""
        setNamespace={() => undefined}
        loadingNamespaces={false}
        repositoryName=""
        setRepositoryName={() => undefined}
        fieldErrors={{}}
        setFieldErrors={() => undefined}
        description=""
        setDescription={() => undefined}
        isPrivate
        setIsPrivate={() => undefined}
        isLoading={false}
        loadingRepos={false}
        generateRemoteUrl={() => 'https://github.com/org/repo.git'}
        repoInspectDeniedReason="Missing permission project:create"
        repoFetchError="Could not load repositories"
        existingRepos={[]}
        selectedExistingRepoUrl=""
        setSelectedExistingRepoUrl={() => undefined}
        customRepoUrl=""
        setCustomRepoUrl={() => undefined}
        conflictStrategy="preferRemote"
        setConflictStrategy={() => undefined}
      />
    );

    expect(screen.getByText('Repository inspection unavailable')).toBeInTheDocument();
    expect(screen.getByText('Missing permission project:create')).toBeInTheDocument();
    expect(screen.queryByText('Could not load repositories')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Enter repository URL')).not.toBeInTheDocument();
  });
});
