/**
 * Git Connections Settings Page
 * Manage connected Git provider accounts
 */

import React, { useState } from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  OverflowMenu,
  OverflowMenuItem,
  Tag,
  Modal,
  TextInput,
  Select,
  SelectItem,
  RadioButtonGroup,
  RadioButton,
} from '@carbon/react';
import {
  Add,
  Checkmark,
  Warning,
  Link as LinkIcon,
  LogoGithub,
} from '@carbon/icons-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { toSafePathSegment } from '../../utils/safeNavigation';
import { useToast } from '../../shared/notifications/ToastProvider';

interface GitConnectionsProps {
  embedded?: boolean;
}

interface Credential {
  id: string;
  userId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  name?: string;
  authType: 'pat' | 'oauth';
  providerUsername?: string;
  expiresAt?: number;
  scopes?: string;
  createdAt: number;
  updatedAt: number;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  supportsOAuth: boolean;
  supportsPAT: boolean;
}

export default function GitConnections({ embedded = false }: GitConnectionsProps) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add modal state
  const [selectedProvider, setSelectedProvider] = useState('');
  const [authMethod, setAuthMethod] = useState<'pat' | 'oauth'>('pat');
  const [token, setToken] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  
  // Rename modal state
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Update token modal state
  const [updateTokenModalOpen, setUpdateTokenModalOpen] = useState(false);
  const [updatedToken, setUpdatedToken] = useState('');
  const [updatingToken, setUpdatingToken] = useState(false);
  const [updateTokenError, setUpdateTokenError] = useState<string | null>(null);

  // Fetch credentials
  const credentialsQuery = useQuery({
    queryKey: ['git', 'credentials'],
    queryFn: () => apiClient.get<Credential[]>('/git-api/credentials'),
  });

  // Fetch providers
  const providersQuery = useQuery({
    queryKey: ['git', 'providers'],
    queryFn: () => apiClient.get<Provider[]>('/git-api/providers'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (providerId: string) =>
      apiClient.delete(`/git-api/credentials/${providerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] });
      setDeleteModalOpen(false);
      setSelectedCredential(null);
    },
  });

  // Get provider icon
  const getProviderIcon = (type: string) => {
    switch (type) {
      case 'github':
        return <LogoGithub size={20} />;
      default:
        return <LinkIcon size={20} />;
    }
  };

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Check if token is expiring soon (within 7 days)
  const isExpiringSoon = (expiresAt?: number) => {
    if (!expiresAt) return false;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return expiresAt - Date.now() < sevenDays;
  };

  // Connect with PAT
  const connectWithPAT = async () => {
    if (!token.trim() || !selectedProvider) return;
    
    setConnecting(true);
    setConnectError(null);
    
    try {
      await apiClient.post('/git-api/credentials', {
        providerId: selectedProvider,
        token,
        name: connectionName.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] });
      resetAddModal();
      notify({ kind: 'success', title: 'Git provider connected' });
    } catch (error: any) {
      const parsed = parseApiError(error, 'Failed to connect');
      setConnectError(parsed.message);
      notify({ kind: 'error', title: 'Failed to connect', subtitle: parsed.message });
    } finally {
      setConnecting(false);
    }
  };

  // Update token
  const handleUpdateToken = async () => {
    if (!selectedCredential || !updatedToken.trim()) return;

    setUpdatingToken(true);
    setUpdateTokenError(null);

    try {
      await apiClient.post('/git-api/credentials', {
        providerId: selectedCredential.providerId,
        token: updatedToken.trim(),
        name: selectedCredential.name || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] });
      setUpdateTokenModalOpen(false);
      setSelectedCredential(null);
      setUpdatedToken('');
      notify({ kind: 'success', title: 'Token updated successfully' });
    } catch (error: any) {
      const parsed = parseApiError(error, 'Failed to update token');
      setUpdateTokenError(parsed.message);
      notify({ kind: 'error', title: 'Failed to update token', subtitle: parsed.message });
    } finally {
      setUpdatingToken(false);
    }
  };

  // Rename credential
  const handleRename = async () => {
    if (!selectedCredential || !newName.trim()) return;
    
    setRenaming(true);
    setRenameError(null);
    
    try {
      await apiClient.patch(`/git-api/credentials/${selectedCredential.id}`, { name: newName.trim() });
      queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] });
      setRenameModalOpen(false);
      setSelectedCredential(null);
      setNewName('');
      notify({ kind: 'success', title: 'Connection renamed' });
    } catch (error: any) {
      const parsed = parseApiError(error, 'Failed to rename');
      setRenameError(parsed.message);
      notify({ kind: 'error', title: 'Failed to rename', subtitle: parsed.message });
    } finally {
      setRenaming(false);
    }
  };

  // Connect with OAuth
  const connectWithOAuth = async () => {
    if (!selectedProvider) return;
    
    setConnecting(true);
    setConnectError(null);
    
    try {
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const safeProviderId = toSafePathSegment(selectedProvider);
      if (!safeProviderId) throw new Error('Invalid provider');

      const popupUrl = `/git-api/oauth/${encodeURIComponent(safeProviderId)}/authorize/redirect`;

      const popup = window.open(
        popupUrl,
        'oauth_popup',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) throw new Error('Popup was blocked');
      
      // Poll for completion
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          setConnecting(false);
          queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] });
          
          // Check if successful
          const success = sessionStorage.getItem('oauth_success');
          if (success) {
            sessionStorage.removeItem('oauth_success');
            resetAddModal();
            notify({ kind: 'success', title: 'Git provider connected' });
          }
        }
      }, 500);
      
    } catch (error: any) {
      const parsed = parseApiError(error, 'Failed to start OAuth');
      setConnectError(parsed.message);
      notify({ kind: 'error', title: 'Failed to start OAuth', subtitle: parsed.message });
      setConnecting(false);
    }
  };

  const resetAddModal = () => {
    setAddModalOpen(false);
    setSelectedProvider('');
    setAuthMethod('pat');
    setToken('');
    setConnectionName('');
    setConnectError(null);
  };

  // Get unconnected providers
  const connectedProviderIds = new Set(credentialsQuery.data?.map(c => c.providerId) || []);
  const unconnectedProviders = providersQuery.data?.filter(p => !connectedProviderIds.has(p.id)) || [];
  const selectedProviderData = providersQuery.data?.find(p => p.id === selectedProvider);

  const visibleCredentials = (credentialsQuery.data || []).filter((cred) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const statusLabel = cred.expiresAt && isExpiringSoon(cred.expiresAt) ? 'expiring soon' : 'active';
    const hay = [
      String(cred.providerName || ''),
      String(cred.providerType || ''),
      String(cred.name || ''),
      String(cred.providerUsername || ''),
      String(cred.authType || ''),
      statusLabel,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const headers = [
    { key: 'provider', header: 'Provider' },
    { key: 'name', header: 'Connection Name' },
    { key: 'username', header: 'Account' },
    { key: 'authType', header: 'Auth Type' },
    { key: 'status', header: 'Status' },
    { key: 'connected', header: 'Connected' },
    { key: 'actions', header: '' },
  ];

  const rows = visibleCredentials.map(cred => ({
    id: cred.id,
    provider: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
        {getProviderIcon(cred.providerType)}
        <span>{cred.providerName}</span>
      </div>
    ),
    name: (
      <span 
        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
        onClick={() => {
          setSelectedCredential(cred);
          setNewName(cred.name || cred.providerUsername || '');
          setRenameModalOpen(true);
        }}
        title="Click to rename"
      >
        {cred.name || cred.providerUsername || '—'}
      </span>
    ),
    username: cred.providerUsername || '—',
    authType: (
      <Tag type={cred.authType === 'oauth' ? 'blue' : 'gray'} size="sm">
        {cred.authType === 'oauth' ? 'OAuth' : 'PAT'}
      </Tag>
    ),
    status: cred.expiresAt && isExpiringSoon(cred.expiresAt) ? (
      <Tag type="red" renderIcon={Warning} size="sm">
        Expiring Soon
      </Tag>
    ) : (
      <Tag type="green" renderIcon={Checkmark} size="sm">
        Active
      </Tag>
    ),
    connected: formatDate(cred.createdAt),
    actions: (
      <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
        <OverflowMenuItem
          itemText="Rename"
          onClick={() => {
            setSelectedCredential(cred);
            setNewName(cred.name || cred.providerUsername || '');
            setRenameModalOpen(true);
          }}
        />
        <OverflowMenuItem
          itemText="Update Token"
          onClick={() => {
            setSelectedCredential(cred);
            setUpdatedToken('');
            setUpdateTokenError(null);
            setUpdateTokenModalOpen(true);
          }}
        />
        <OverflowMenuItem
          itemText="Disconnect"
          hasDivider
          isDelete
          onClick={() => {
            setSelectedCredential(cred);
            setDeleteModalOpen(true);
          }}
        />
      </OverflowMenu>
    ),
    _credential: cred,
  }));

  const content = (
    <>
      {credentialsQuery.isLoading ? (
        <TableContainer>
          <TableToolbar>
            <TableToolbarContent>
              <TableToolbarSearch
                persistent
                onChange={(e: any) => setSearchQuery(e.target.value)}
                value={searchQuery}
                placeholder="Search connections"
              />
              <Button
                kind="primary"
                renderIcon={Add}
                onClick={() => setAddModalOpen(true)}
                disabled={unconnectedProviders.length === 0}
              >
                Connect Provider
              </Button>
            </TableToolbarContent>
          </TableToolbar>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={headers}
            rowCount={8}
            columnCount={headers.length}
          />
        </TableContainer>
      ) : credentialsQuery.isError ? (
        <div />
      ) : (credentialsQuery.data || []).length === 0 ? (
        <div style={{
          padding: 'var(--spacing-7)',
          textAlign: 'center',
          backgroundColor: 'var(--cds-layer-01)',
          borderRadius: '8px',
          border: '1px solid var(--cds-border-subtle-01)',
        }}>
          <LinkIcon size={48} style={{ color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-4)' }} />
          <h3 style={{ margin: '0 0 var(--spacing-2) 0' }}>No Git Providers Connected</h3>
          <p style={{ color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
            Connect a Git provider to sync your projects with remote repositories.
          </p>
          <Button kind="secondary" renderIcon={Add} onClick={() => setAddModalOpen(true)}>
            Connect Provider
          </Button>
        </div>
      ) : (
        <TableContainer>
          <DataTable rows={rows} headers={headers}>
            {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps, getToolbarProps }) => (
              <>
                <TableToolbar {...getToolbarProps()}>
                  <TableToolbarContent>
                    <TableToolbarSearch
                      persistent
                      onChange={(e: any) => setSearchQuery(e.target.value)}
                      value={searchQuery}
                      placeholder="Search connections"
                    />
                    <Button
                      kind="primary"
                      renderIcon={Add}
                      onClick={() => setAddModalOpen(true)}
                      disabled={unconnectedProviders.length === 0}
                    >
                      Connect Provider
                    </Button>
                  </TableToolbarContent>
                </TableToolbar>
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader
                          {...getHeaderProps({ header })}
                          key={header.key}
                          style={header.key === 'actions' ? { width: 48, textAlign: 'right' } : undefined}
                        >
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No connections match this search.</TableCell>
                      </TableRow>
                    )}
                    {tableRows.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell
                            key={cell.id}
                            style={cell.info.header === 'actions' ? { textAlign: 'right' } : undefined}
                          >
                            {cell.value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </DataTable>
        </TableContainer>
      )}

      {/* Add Connection Modal */}
      <Modal
        open={addModalOpen}
        onRequestClose={resetAddModal}
        modalHeading="Connect Git Provider"
        primaryButtonText={connecting ? 'Connecting...' : 'Connect'}
        secondaryButtonText="Cancel"
        onRequestSubmit={authMethod === 'pat' ? connectWithPAT : connectWithOAuth}
        primaryButtonDisabled={
          connecting || 
          !selectedProvider || 
          (authMethod === 'pat' && !token.trim())
        }
        size="sm"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <Select
            id="provider-select"
            labelText="Git Provider"
            value={selectedProvider}
            onChange={(e) => {
              setSelectedProvider(e.target.value);
              setConnectError(null);
            }}
            disabled={connecting}
          >
            <SelectItem value="" text="Select a provider..." />
            {unconnectedProviders.map(provider => (
              <SelectItem key={provider.id} value={provider.id} text={provider.name} />
            ))}
          </Select>

          {selectedProvider && (
            <>
              <RadioButtonGroup
                name="auth-method"
                legendText="Authentication Method"
                valueSelected={authMethod}
                onChange={(value) => setAuthMethod(value as 'pat' | 'oauth')}
                orientation="horizontal"
              >
                <RadioButton 
                  labelText="Personal Access Token" 
                  value="pat" 
                  disabled={!selectedProviderData?.supportsPAT}
                />
                <RadioButton 
                  labelText="OAuth" 
                  value="oauth" 
                  disabled={!selectedProviderData?.supportsOAuth}
                />
              </RadioButtonGroup>

              {authMethod === 'pat' && (
                <>
                  <TextInput
                    id="connection-name-input"
                    labelText="Connection Name (Optional)"
                    placeholder="e.g., Work GitHub, Personal"
                    value={connectionName}
                    onChange={(e) => setConnectionName(e.target.value)}
                    disabled={connecting}
                    helperText="Give this connection a name to identify it later"
                  />
                  <TextInput
                    id="token-input"
                    labelText="Personal Access Token"
                    type="password"
                    placeholder="Enter your token..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={connecting}
                    helperText={`Create a token at ${selectedProviderData?.baseUrl}/settings/tokens`}
                  />
                </>
              )}

              {authMethod === 'oauth' && (
                <p style={{ color: 'var(--cds-text-secondary)', fontSize: '14px' }}>
                  You'll be redirected to {selectedProviderData?.name} to authorize access.
                </p>
              )}
            </>
          )}

          {connectError && (
            <div style={{ color: 'var(--cds-support-error)', fontSize: 14 }}>
              {connectError}
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onRequestClose={() => {
          setDeleteModalOpen(false);
          setSelectedCredential(null);
        }}
        modalHeading="Disconnect Provider"
        primaryButtonText={deleteMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
        secondaryButtonText="Cancel"
        onRequestSubmit={() => selectedCredential && deleteMutation.mutate(selectedCredential.providerId)}
        primaryButtonDisabled={deleteMutation.isPending}
        danger
        size="sm"
      >
        <p>
          Are you sure you want to disconnect <strong>{selectedCredential?.providerName}</strong>?
        </p>
        <p style={{ marginTop: 'var(--spacing-3)', color: 'var(--cds-text-secondary)' }}>
          You won't be able to sync projects with this provider until you reconnect.
        </p>
      </Modal>

      {/* Update Token Modal */}
      <Modal
        open={updateTokenModalOpen}
        onRequestClose={() => {
          setUpdateTokenModalOpen(false);
          setSelectedCredential(null);
          setUpdatedToken('');
          setUpdateTokenError(null);
        }}
        modalHeading="Update Access Token"
        primaryButtonText={updatingToken ? 'Updating...' : 'Update Token'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleUpdateToken}
        primaryButtonDisabled={updatingToken || !updatedToken.trim()}
        size="sm"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <p style={{ color: 'var(--cds-text-secondary)', fontSize: '14px' }}>
            Replace the stored token for <strong>{selectedCredential?.name || selectedCredential?.providerUsername || selectedCredential?.providerName}</strong>.
          </p>
          <TextInput
            id="update-token-input"
            labelText="New Personal Access Token"
            type="password"
            placeholder="Paste your new token..."
            value={updatedToken}
            onChange={(e) => setUpdatedToken(e.target.value)}
            disabled={updatingToken}
            helperText="The new token will be validated and encrypted before saving"
          />
          {updateTokenError && (
            <div style={{ color: 'var(--cds-support-error)', fontSize: 14 }}>
              {updateTokenError}
            </div>
          )}
        </div>
      </Modal>

      {/* Rename Connection Modal */}
      <Modal
        open={renameModalOpen}
        onRequestClose={() => {
          setRenameModalOpen(false);
          setSelectedCredential(null);
          setNewName('');
          setRenameError(null);
        }}
        modalHeading="Rename Connection"
        primaryButtonText={renaming ? 'Saving...' : 'Save'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleRename}
        primaryButtonDisabled={renaming || !newName.trim()}
        size="sm"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="rename-input"
            labelText="Connection Name"
            placeholder="e.g., Work GitHub, Personal"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={renaming}
          />
          {selectedCredential?.providerUsername && (
            <p style={{ color: 'var(--cds-text-secondary)', fontSize: '14px' }}>
              Account: {selectedCredential.providerUsername}
            </p>
          )}
          {renameError && (
            <div style={{ color: 'var(--cds-support-error)', fontSize: 14 }}>
              {renameError}
            </div>
          )}
        </div>
      </Modal>
    </>
  );

  if (embedded) {
    return <div style={{ padding: 'var(--spacing-5)' }}>{content}</div>;
  }

  return (
    <PageLayout>
      <PageHeader
        icon={LinkIcon}
        title="Git Connections"
        subtitle="Manage your connected Git provider accounts"
        gradient={PAGE_GRADIENTS.blue}
      />
      {content}
    </PageLayout>
  );
}
