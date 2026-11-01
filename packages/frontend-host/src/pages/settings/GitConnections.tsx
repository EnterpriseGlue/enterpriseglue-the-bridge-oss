/**
 * Git Connections Settings Page
 * Manage connected Git provider accounts
 */

import React, { useEffect, useRef, useState } from 'react';
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
  InlineNotification,
} from '@carbon/react';
import {
  Add,
  Checkmark,
  Warning,
  Link as LinkIcon,
  LogoGithub,
} from '@carbon/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { useAuth } from '../../shared/hooks/useAuth';
import { permissionSnapshotAuthorityKey } from '../../contexts/authSessionPermissions';
import { getBrowserSessionRevision } from '../../utils/browserSession';
import { listPersonalGitCredentials, listGitCredentialProviders, savePersonalGitCredential, renamePersonalGitCredential, disconnectPersonalGitCredential } from '../../features/git/api/personalCredentials';
import { beginGitOAuth } from '../../features/git/api/gitOAuthPopup';
import type { GitCredential as Credential } from '@enterpriseglue/shared/schemas/git/repository.js';
import { useToast } from '../../shared/notifications/ToastProvider';

interface GitConnectionsProps {
  embedded?: boolean;
}

export default function GitConnections(props: GitConnectionsProps) {
  const auth = useAuth();
  const userId = auth.user?.session?.principal.id || auth.user?.id || '';
  const authority = JSON.stringify([userId, auth.user?.session?.tenant.id || null, auth.sessionRevision ?? null, permissionSnapshotAuthorityKey(auth.permissions)]);
  return <GitConnectionsPanel key={authority} {...props} userId={userId} authority={authority} />;
}

function GitConnectionsPanel({ embedded = false, userId, authority }: GitConnectionsProps & { userId: string; authority: string }) {
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
  const [connectError, setConnectError] = useState<string | null>(null);
  
  // Rename modal state
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Update token modal state
  const [updateTokenModalOpen, setUpdateTokenModalOpen] = useState(false);
  const [updatedToken, setUpdatedToken] = useState('');
  const [updateTokenError, setUpdateTokenError] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  type Operation = 'connect' | 'rename' | 'token' | 'disconnect';
  const [busy, setBusy] = useState<Operation | null>(null);
  const connecting = busy === 'connect', renaming = busy === 'rename', updatingToken = busy === 'token', disconnecting = busy === 'disconnect';
  const lifetime = useRef(0), active = useRef(false), mounted = useRef(true);
  const intent = useRef('');
  intent.current = JSON.stringify([addModalOpen, renameModalOpen, updateTokenModalOpen, deleteModalOpen, selectedProvider, authMethod, selectedCredential?.id]);
  const renderedSession = useRef(getBrowserSessionRevision()).current;
  const oauthCancel = useRef<(() => void) | null>(null);
  const current = (id: number) => mounted.current && id === lifetime.current && renderedSession === getBrowserSessionRevision();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifetime.current++; oauthCancel.current?.(); }; }, []);

  const credentialsQuery = useQuery({
    queryKey: ['git', 'credentials', authority], queryFn: () => listPersonalGitCredentials(userId), enabled: !!userId,
  });
  const providersQuery = useQuery({
    queryKey: ['git', 'providers', authority], queryFn: listGitCredentialProviders, enabled: !!userId,
  });

  const resetDialogs = () => {
    lifetime.current++; active.current = false; oauthCancel.current?.(); oauthCancel.current = null;
    setBusy(null); setAddModalOpen(false); setDeleteModalOpen(false); setRenameModalOpen(false); setUpdateTokenModalOpen(false);
    setSelectedCredential(null); setSelectedProvider(''); setAuthMethod('pat'); setToken(''); setUpdatedToken('');
    setConnectionName(''); setNewName(''); setConnectError(null); setRenameError(null); setUpdateTokenError(null); setDeleteError(null);
  };
  const beginDialog = (kind: Operation, credential?: Credential) => {
    if (!current(lifetime.current) || !userId || !credentialsQuery.isSuccess || (kind === 'connect' && !providersQuery.isSuccess)) return;
    if (credential && !credentialsQuery.data.some(row => row.id === credential.id && row.providerId === credential.providerId)) return;
    resetDialogs();
    if (kind === 'connect') setAddModalOpen(true);
    else {
      setSelectedCredential(credential!);
      if (kind === 'rename') { setNewName(credential!.name || credential!.providerUsername || ''); setRenameModalOpen(true); }
      else if (kind === 'token') setUpdateTokenModalOpen(true);
      else setDeleteModalOpen(true);
    }
  };
  const setOperationError = (kind: Operation, message: string | null) => {
    if (kind === 'connect') setConnectError(message);
    else if (kind === 'rename') setRenameError(message);
    else if (kind === 'token') setUpdateTokenError(message);
    else setDeleteError(message);
  };
  const runOwned = async (kind: Operation, perform: (check: () => void) => Promise<unknown>, success: string, privateToken?: string) => {
    if (!current(lifetime.current) || active.current || !credentialsQuery.isSuccess) return;
    const id = lifetime.current, capturedIntent = intent.current;
    const check = () => { if (!current(id) || intent.current !== capturedIntent) throw new Error('Git credential context changed'); };
    active.current = true; setBusy(kind); setOperationError(kind, null);
    try {
      check(); await perform(check); check();
      await queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] }); check();
      notify({ kind: 'success', title: success }); resetDialogs();
    } catch (error) {
      if (!current(id) || intent.current !== capturedIntent) return;
      const raw = parseApiError(error, 'Git credential change failed').message;
      const message = privateToken ? raw.split(privateToken).join('[redacted]') : raw;
      setOperationError(kind, message);
      notify({ kind: 'error', title: 'Git credential change failed', subtitle: message });
    } finally { if (current(id)) { active.current = false; setBusy(null); oauthCancel.current = null; } }
  };

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

  const connectWithPAT = () => {
    if (!addModalOpen || !token.trim() || !selectedProviderData?.supportsPAT || !unconnectedProviders.some(row => row.id === selectedProvider)) return;
    const request = { providerId: selectedProvider, token: token.trim(), name: connectionName.trim() || undefined };
    void runOwned('connect', check => savePersonalGitCredential(userId, request, check), 'Git provider connected', request.token);
  };
  const handleUpdateToken = () => {
    if (!updateTokenModalOpen || !selectedCredential || !updatedToken.trim()) return;
    if (credentialsQuery.data?.filter(row => row.providerId === selectedCredential.providerId).length !== 1) {
      setUpdateTokenError('Token replacement cannot identify one saved connection for this provider'); return;
    }
    const request = { providerId: selectedCredential.providerId, token: updatedToken.trim(), name: selectedCredential.name || undefined };
    const expectedId = selectedCredential.id;
    void runOwned('token', check => savePersonalGitCredential(userId, request, check, expectedId), 'Token updated successfully', request.token);
  };
  const handleRename = () => {
    if (!renameModalOpen || !selectedCredential || !newName.trim()) return;
    const captured = { ...selectedCredential }, name = newName.trim();
    void runOwned('rename', check => renamePersonalGitCredential(userId, captured, name, check), 'Connection renamed');
  };
  const handleDisconnect = () => {
    if (!deleteModalOpen || !selectedCredential) return;
    const captured = { ...selectedCredential };
    void runOwned('disconnect', check => disconnectPersonalGitCredential(userId, captured, check), 'Git provider disconnected');
  };
  const connectWithOAuth = () => {
    if (!addModalOpen || !selectedProviderData?.supportsOAuth || !unconnectedProviders.some(row => row.id === selectedProvider)) return;
    const provider = selectedProvider;
    void runOwned('connect', check => {
      const flow = beginGitOAuth(provider, userId, check); oauthCancel.current = flow.cancel;
      return flow.result;
    }, 'Git provider connected');
  };
  const resetAddModal = resetDialogs;

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
          beginDialog('rename', cred);
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
            beginDialog('rename', cred);
          }}
        />
        <OverflowMenuItem
          itemText="Update Token"
          onClick={() => {
            beginDialog('token', cred);
          }}
        />
        <OverflowMenuItem
          itemText="Disconnect"
          hasDivider
          isDelete
          onClick={() => {
            beginDialog('disconnect', cred);
          }}
        />
      </OverflowMenu>
    ),
    _credential: cred,
  }));

  const content = (
    <>
      {providersQuery.isError && <InlineNotification kind="error" title="Git providers unavailable" subtitle="Git provider list was not verified" lowContrast hideCloseButton />}
      {!userId || credentialsQuery.isLoading ? (
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
                onClick={() => beginDialog('connect')}
                disabled={!providersQuery.isSuccess || !credentialsQuery.isSuccess || unconnectedProviders.length === 0}
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
        <InlineNotification kind="error" title="Git connections unavailable" subtitle="Git credential list was not verified" lowContrast hideCloseButton />
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
          <Button kind="secondary" renderIcon={Add} onClick={() => beginDialog('connect')} disabled={!credentialsQuery.isSuccess || !providersQuery.isSuccess || unconnectedProviders.length === 0}>
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
                      onClick={() => beginDialog('connect')}
                      disabled={!providersQuery.isSuccess || !credentialsQuery.isSuccess || unconnectedProviders.length === 0}
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
          (authMethod === 'pat' ? !token.trim() || !selectedProviderData?.supportsPAT : !selectedProviderData?.supportsOAuth)
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
              setAuthMethod(providersQuery.data?.find(row => row.id === e.target.value)?.supportsPAT ? 'pat' : 'oauth');
              setToken(''); setConnectError(null);
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
                disabled={connecting}
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
        onRequestClose={resetDialogs}
        modalHeading="Disconnect Provider"
        primaryButtonText={disconnecting ? 'Disconnecting...' : 'Disconnect'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleDisconnect}
        primaryButtonDisabled={disconnecting || !selectedCredential}
        danger
        size="sm"
      >
        {deleteError && <InlineNotification kind="error" title="Disconnect failed" subtitle={deleteError} lowContrast hideCloseButton />}
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
        onRequestClose={resetDialogs}
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
        onRequestClose={resetDialogs}
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
