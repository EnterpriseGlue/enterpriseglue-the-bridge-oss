import React from 'react';
import {
  Button,
  Checkbox,
  CodeSnippet,
  DataTableSkeleton,
  InlineNotification,
  Link,
  Modal,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from '@carbon/react';
import { Add, Renew, Security, TrashCan } from '@carbon/icons-react';
import type {
  IdentityProvisioningCredentialIssued,
  IdentityProvisioningCredentialMetadata,
  IdentityProvisioningDiagnostic,
  IdentityProvisioningDirectoryRecord,
  IdentityProvisioningDirectoryTestResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/provisioning.js';
import { identityProvisioningApi } from '../../../api/platform-admin/identityProvisioning';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import ConfirmModal from '../../../shared/components/ConfirmModal';
import { useModal } from '../../../shared/hooks/useModal';
import { useToast } from '../../../shared/notifications/ToastProvider';

interface IdentityProvisioningSettingsTabProps {
  canManage: boolean;
  unavailableReason?: string | null;
}

interface DirectoryForm {
  key: string;
  displayName: string;
  description: string;
  identityProviderKey: string;
  isEnabled: boolean;
}

const emptyDirectoryForm: DirectoryForm = {
  key: '',
  displayName: '',
  description: '',
  identityProviderKey: '',
  isEnabled: false,
};

function time(value: number | null | undefined): string {
  return value == null ? 'Never' : new Date(Number(value)).toLocaleString();
}

function credentialTag(status: IdentityProvisioningCredentialMetadata['status']): 'green' | 'blue' | 'red' | 'warm-gray' {
  if (status === 'active') return 'green';
  if (status === 'overlap') return 'blue';
  if (status === 'revoked' || status === 'expired') return 'red';
  return 'warm-gray';
}

export default function IdentityProvisioningSettingsTab({ canManage, unavailableReason }: IdentityProvisioningSettingsTabProps) {
  const { notify } = useToast();
  const archiveModal = useModal<IdentityProvisioningDirectoryRecord>();
  const revokeModal = useModal<IdentityProvisioningCredentialMetadata>();
  const [directories, setDirectories] = React.useState<IdentityProvisioningDirectoryRecord[]>([]);
  const [selectedKey, setSelectedKey] = React.useState('');
  const [credentials, setCredentials] = React.useState<IdentityProvisioningCredentialMetadata[]>([]);
  const [events, setEvents] = React.useState<IdentityProvisioningDiagnostic[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [directoryForm, setDirectoryForm] = React.useState<DirectoryForm>(emptyDirectoryForm);
  const [credentialModalOpen, setCredentialModalOpen] = React.useState(false);
  const [credentialName, setCredentialName] = React.useState('Directory provisioning');
  const [issuedCredential, setIssuedCredential] = React.useState<IdentityProvisioningCredentialIssued | null>(null);
  const [credentialStored, setCredentialStored] = React.useState(false);
  const [testResult, setTestResult] = React.useState<IdentityProvisioningDirectoryTestResponse | null>(null);

  const selected = directories.find((directory) => directory.key === selectedKey) || null;
  const configManaged = Boolean(selected && selected.ownershipMode !== 'manual');
  const mutationDisabled = !canManage || configManaged;
  const mutationReason = configManaged
    ? `Managed by ${selected?.sourceRef || 'a configuration bundle'}`
    : unavailableReason || null;

  const loadDirectories = React.useCallback(async (preferredKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await identityProvisioningApi.list();
      setDirectories(result.items);
      const nextKey = preferredKey && result.items.some((directory) => directory.key === preferredKey)
        ? preferredKey
        : selectedKey && result.items.some((directory) => directory.key === selectedKey)
          ? selectedKey
          : result.items[0]?.key || '';
      setSelectedKey(nextKey);
      if (result.items.length === 0) setShowCreate(true);
    } catch (loadError) {
      setError(parseApiError(loadError, 'Failed to load provisioning directories').message);
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  const loadDirectoryDetails = React.useCallback(async () => {
    if (!selectedKey) {
      setCredentials([]);
      setEvents([]);
      return;
    }
    setDetailLoading(true);
    try {
      const [credentialResult, eventResult] = await Promise.all([
        identityProvisioningApi.credentials(selectedKey),
        identityProvisioningApi.events(selectedKey),
      ]);
      setCredentials(credentialResult.items);
      setEvents(eventResult.items);
    } catch (detailError) {
      notify({ kind: 'error', title: 'Provisioning details unavailable', subtitle: parseApiError(detailError, 'Failed to load credentials and diagnostics').message });
    } finally {
      setDetailLoading(false);
    }
  }, [notify, selectedKey]);

  React.useEffect(() => { void loadDirectories(); }, []);
  React.useEffect(() => { void loadDirectoryDetails(); }, [loadDirectoryDetails]);

  const createDirectory = async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      const created = await identityProvisioningApi.create({
        key: directoryForm.key.trim().toLowerCase(),
        displayName: directoryForm.displayName.trim(),
        description: directoryForm.description.trim() || null,
        identityProviderKey: directoryForm.identityProviderKey.trim() || null,
        isEnabled: directoryForm.isEnabled,
        authoritative: true,
      });
      notify({ kind: 'success', title: 'Provisioning directory created', subtitle: 'Create a reveal-once bearer credential before configuring your directory provider.' });
      setShowCreate(false);
      setDirectoryForm(emptyDirectoryForm);
      await loadDirectories(created.key);
    } catch (createError) {
      notify({ kind: 'error', title: 'Directory not created', subtitle: parseApiError(createError, 'Failed to create provisioning directory').message });
    } finally {
      setBusy(false);
    }
  };

  const toggleDirectory = async () => {
    if (!selected || mutationDisabled) return;
    setBusy(true);
    try {
      await identityProvisioningApi.update(selected.key, { isEnabled: selected.status !== 'active' });
      setTestResult(null);
      await loadDirectories(selected.key);
      notify({ kind: 'success', title: selected.status === 'active' ? 'Provisioning disabled' : 'Provisioning enabled' });
    } catch (updateError) {
      notify({ kind: 'error', title: 'Directory not updated', subtitle: parseApiError(updateError, 'Failed to update provisioning directory').message });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!selected || !canManage) return;
    setBusy(true);
    try {
      const result = await identityProvisioningApi.test(selected.key);
      setTestResult(result);
      notify({ kind: result.status === 'ready' ? 'success' : 'warning', title: result.status === 'ready' ? 'Provisioning endpoint ready' : 'Provisioning needs attention' });
    } catch (testError) {
      notify({ kind: 'error', title: 'Readiness check failed', subtitle: parseApiError(testError, 'Failed to test provisioning readiness').message });
    } finally {
      setBusy(false);
    }
  };

  const issueCredential = async () => {
    if (!selected || mutationDisabled || !credentialName.trim()) return;
    setBusy(true);
    try {
      const issued = await identityProvisioningApi.issueCredential(selected.key, credentialName.trim());
      setCredentialModalOpen(false);
      setCredentialName('Directory provisioning');
      setCredentialStored(false);
      setIssuedCredential(issued);
      await loadDirectoryDetails();
    } catch (credentialError) {
      notify({ kind: 'error', title: 'Credential not created', subtitle: parseApiError(credentialError, 'Failed to create credential').message });
    } finally {
      setBusy(false);
    }
  };

  const rotateCredential = async (credential: IdentityProvisioningCredentialMetadata) => {
    if (!selected || mutationDisabled) return;
    setBusy(true);
    try {
      const issued = await identityProvisioningApi.rotateCredential(selected.key, credential.id, {
        name: `${credential.name} replacement`,
        overlapSeconds: 3600,
      });
      setCredentialStored(false);
      setIssuedCredential(issued);
      await loadDirectoryDetails();
    } catch (rotateError) {
      notify({ kind: 'error', title: 'Credential not rotated', subtitle: parseApiError(rotateError, 'Failed to rotate credential').message });
    } finally {
      setBusy(false);
    }
  };

  const revokeCredential = async () => {
    if (!selected || !revokeModal.data || mutationDisabled) return;
    setBusy(true);
    try {
      await identityProvisioningApi.revokeCredential(selected.key, revokeModal.data.id);
      revokeModal.closeModal();
      await loadDirectoryDetails();
      notify({ kind: 'success', title: 'Credential revoked', subtitle: 'The bearer token can no longer access the SCIM endpoint.' });
    } catch (revokeError) {
      notify({ kind: 'error', title: 'Credential not revoked', subtitle: parseApiError(revokeError, 'Failed to revoke credential').message });
    } finally {
      setBusy(false);
    }
  };

  const archiveDirectory = async () => {
    if (!archiveModal.data || mutationDisabled) return;
    setBusy(true);
    try {
      await identityProvisioningApi.archive(archiveModal.data.key);
      archiveModal.closeModal();
      setSelectedKey('');
      await loadDirectories();
      notify({ kind: 'success', title: 'Provisioning directory archived', subtitle: 'All associated credentials were revoked.' });
    } catch (archiveError) {
      notify({ kind: 'error', title: 'Directory not archived', subtitle: parseApiError(archiveError, 'Failed to archive directory').message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
        <div>
          <p className="cds--label">IDENTITY PROVISIONING</p>
          <h2 style={{ fontWeight: 400, marginBottom: 'var(--spacing-2)' }}>Provisioning directories</h2>
          <p style={{ color: 'var(--cds-text-secondary)', maxWidth: '46rem' }}>
            Configure an authoritative SCIM 2.0 lifecycle source independently from the identity provider used for sign-in.
          </p>
        </div>
        {canManage && !showCreate && (
          <Button renderIcon={Add} onClick={() => setShowCreate(true)}>Create directory</Button>
        )}
      </div>

      {!canManage && unavailableReason && <InlineNotification kind="info" title="Read-only provisioning configuration" subtitle={unavailableReason} hideCloseButton />}
      {error && <InlineNotification kind="error" title="Provisioning unavailable" subtitle={error} hideCloseButton />}

      {showCreate && (
        <Tile>
          <h3 style={{ marginBottom: 'var(--spacing-4)' }}>Create authoritative SCIM directory</h3>
          <InlineNotification
            kind="info"
            title="Authentication remains separate"
            subtitle="This connection creates, updates, suspends, and reconciles users and groups. Configure OIDC or SAML separately under Identity providers."
            hideCloseButton
            lowContrast
          />
          <div className="eg-provisioning-form-grid">
            <TextInput id="provisioning-name" labelText="Directory name" value={directoryForm.displayName} onChange={(event) => setDirectoryForm({ ...directoryForm, displayName: event.target.value })} />
            <TextInput id="provisioning-key" labelText="Directory key" helperText="Lowercase stable key used in the SCIM endpoint." value={directoryForm.key} onChange={(event) => setDirectoryForm({ ...directoryForm, key: event.target.value })} />
            <TextInput id="provisioning-idp" labelText="Related identity provider key (optional)" helperText="For administrative context only; it does not combine sign-in and provisioning." value={directoryForm.identityProviderKey} onChange={(event) => setDirectoryForm({ ...directoryForm, identityProviderKey: event.target.value })} />
            <Select id="provisioning-enabled" labelText="Initial state" value={directoryForm.isEnabled ? 'active' : 'disabled'} onChange={(event) => setDirectoryForm({ ...directoryForm, isEnabled: event.target.value === 'active' })}>
              <SelectItem value="disabled" text="Disabled — configure and test first" />
              <SelectItem value="active" text="Active" />
            </Select>
            <TextArea id="provisioning-description" labelText="Description (optional)" rows={3} value={directoryForm.description} onChange={(event) => setDirectoryForm({ ...directoryForm, description: event.target.value })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-5)' }}>
            {directories.length > 0 && <Button kind="secondary" onClick={() => { setShowCreate(false); setDirectoryForm(emptyDirectoryForm); }}>Cancel</Button>}
            <Button disabled={!canManage || busy || !directoryForm.key.trim() || !directoryForm.displayName.trim()} onClick={createDirectory}>Create directory</Button>
          </div>
        </Tile>
      )}

      {loading ? <DataTableSkeleton showHeader={false} showToolbar={false} columnCount={4} rowCount={3} /> : directories.length > 0 && (
        <>
          <Select id="provisioning-directory-selector" labelText="Provisioning directory" value={selectedKey} onChange={(event) => { setSelectedKey(event.target.value); setTestResult(null); }}>
            {directories.map((directory) => <SelectItem key={directory.key} value={directory.key} text={`${directory.displayName} — ${directory.status}`} />)}
          </Select>

          {selected && (
            <>
              {configManaged && <InlineNotification kind="info" title="Configuration-managed directory" subtitle={mutationReason || ''} hideCloseButton />}
              <Tile>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
                  <div>
                    <div className="eg-provisioning-directory-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                      <h3>{selected.displayName}</h3>
                      <Tag type={selected.status === 'active' ? 'green' : selected.status === 'disabled' ? 'warm-gray' : 'red'}>{selected.status}</Tag>
                      <Tag type="teal">authoritative</Tag>
                    </div>
                    <p style={{ marginTop: 'var(--spacing-2)', color: 'var(--cds-text-secondary)' }}>{selected.description || 'No description provided.'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                    <Button kind="secondary" renderIcon={Security} disabled={!canManage || busy} onClick={runTest}>Test readiness</Button>
                    <Button kind="secondary" disabled={mutationDisabled || busy} title={mutationReason || undefined} onClick={toggleDirectory}>{selected.status === 'active' ? 'Disable' : 'Enable'}</Button>
                    <Button kind="danger--tertiary" renderIcon={TrashCan} disabled={mutationDisabled || busy} title={mutationReason || undefined} onClick={() => archiveModal.openModal(selected)}>Archive</Button>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--spacing-5)' }}>
                  <p className="cds--label">SCIM BASE URL</p>
                  <CodeSnippet type="single" feedback="SCIM endpoint copied">{`${window.location.origin}/scim/v2/${selected.key}`}</CodeSnippet>
                </div>
                {testResult && (
                  <InlineNotification
                    kind={testResult.status === 'ready' ? 'success' : 'warning'}
                    title={testResult.status === 'ready' ? 'Ready for directory traffic' : 'Attention required'}
                    subtitle={`${testResult.activeCredentialCount} active credential${testResult.activeCredentialCount === 1 ? '' : 's'}; directory is ${testResult.directoryStatus}.`}
                    hideCloseButton
                    lowContrast
                  />
                )}
              </Tile>

              <Tabs>
                <TabList contained aria-label="Provisioning directory details">
                  <Tab>Overview</Tab>
                  <Tab>Credentials</Tab>
                  <Tab>Diagnostics</Tab>
                </TabList>
                <TabPanels>
                  <TabPanel>
                    <Tile>
                      <dl className="eg-user-detail-grid">
                        <div className="eg-user-detail-definition"><dt>Directory key</dt><dd>{selected.key}</dd></div>
                        <div className="eg-user-detail-definition"><dt>Provisioning protocol</dt><dd>SCIM 2.0</dd></div>
                        <div className="eg-user-detail-definition"><dt>Related sign-in provider</dt><dd>{selected.identityProviderKey || 'Not linked'}</dd></div>
                        <div className="eg-user-detail-definition"><dt>Ownership</dt><dd>{selected.ownershipMode.replace('_', ' ')}</dd></div>
                        <div className="eg-user-detail-definition"><dt>Last configuration apply</dt><dd>{time(selected.lastAppliedAt)}</dd></div>
                        <div className="eg-user-detail-definition"><dt>Drift status</dt><dd>{selected.driftStatus || 'Not applicable'}</dd></div>
                      </dl>
                    </Tile>
                    <InlineNotification
                      kind="info"
                      title="Provider configuration"
                      subtitle="Use OAuth 2.0 client credentials for short-lived SCIM access tokens. Static bearer use remains available for existing private integrations. The reveal-once secret is hashed before storage."
                      hideCloseButton
                      lowContrast
                    />
                  </TabPanel>
                  <TabPanel>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
                      <div><h3>Provisioning credentials</h3><p className="eg-secondary-text">Each credential can issue short-lived OAuth access tokens. Only fingerprints and operational metadata remain visible after issuance.</p></div>
                      <Button size="sm" renderIcon={Add} disabled={mutationDisabled || busy} title={mutationReason || undefined} onClick={() => setCredentialModalOpen(true)}>Create credential</Button>
                    </div>
                    {detailLoading ? <DataTableSkeleton showHeader={false} showToolbar={false} columnCount={4} rowCount={3} /> : (
                      <div className="eg-user-detail-list">
                        {credentials.map((credential) => (
                          <Tile key={credential.id}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
                              <div>
                                <Tag type={credentialTag(credential.status)}>{credential.status}</Tag>
                                <h3>{credential.name}</h3>
                                <p>Fingerprint {credential.fingerprint}</p>
                                <p className="eg-secondary-text">Last used {time(credential.lastUsedAt)} · Expires {time(credential.expiresAt)}</p>
                              </div>
                              <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                <Button kind="ghost" size="sm" renderIcon={Renew} disabled={mutationDisabled || credential.status === 'revoked' || busy} onClick={() => rotateCredential(credential)}>Rotate</Button>
                                <Button kind="danger--ghost" size="sm" renderIcon={TrashCan} disabled={mutationDisabled || credential.status === 'revoked' || busy} onClick={() => revokeModal.openModal(credential)}>Revoke</Button>
                              </div>
                            </div>
                          </Tile>
                        ))}
                        {credentials.length === 0 && <InlineNotification kind="warning" title="No provisioning credential" subtitle="Create a bearer credential before enabling the directory client." hideCloseButton />}
                      </div>
                    )}
                  </TabPanel>
                  <TabPanel>
                    <p style={{ marginBottom: 'var(--spacing-4)', color: 'var(--cds-text-secondary)' }}>Sanitized recent SCIM requests and lifecycle outcomes. Raw request bodies and credentials are never retained here.</p>
                    <div className="eg-user-detail-list">
                      {events.map((event) => (
                        <Tile key={event.id}>
                          <Tag type={event.status === 'success' || event.status === 'accepted' ? 'green' : event.status === 'failed' ? 'red' : 'blue'}>{event.status}</Tag>
                          <h3>{event.eventType}</h3>
                          <p>{event.message || event.code || 'No additional diagnostic message.'}</p>
                          <p className="eg-secondary-text">{time(event.occurredAt)} · Request {event.requestId} · {event.resourceType || 'Directory'} {event.resourceId || ''}</p>
                        </Tile>
                      ))}
                      {events.length === 0 && <p>No provisioning diagnostics have been recorded.</p>}
                    </div>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </>
          )}
        </>
      )}

      <Modal
        open={credentialModalOpen}
        modalHeading="Create provisioning credential"
        primaryButtonText={busy ? 'Creating…' : 'Create credential'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={busy || !credentialName.trim()}
        onRequestClose={() => !busy && setCredentialModalOpen(false)}
        onRequestSubmit={issueCredential}
        size="sm"
      >
        <TextInput id="provisioning-credential-name" labelText="Credential name" helperText="Use a name that identifies the directory application or rotation window." value={credentialName} onChange={(event) => setCredentialName(event.target.value)} />
      </Modal>

      <Modal
        open={Boolean(issuedCredential)}
        modalHeading="Copy the client credential now"
        primaryButtonText="I've stored the credential"
        primaryButtonDisabled={!credentialStored}
        preventCloseOnClickOutside
        onRequestClose={() => {
          if (credentialStored) setIssuedCredential(null);
        }}
        onRequestSubmit={() => setIssuedCredential(null)}
        size="sm"
      >
        <InlineNotification kind="warning" title="Reveal once" subtitle="The client secret cannot be retrieved again. Copy these values into your directory provider before closing this dialog." hideCloseButton lowContrast />
        {issuedCredential && (
          <>
            <p style={{ margin: 'var(--spacing-4) 0 var(--spacing-2)' }}>Credential: <strong>{issuedCredential.credential.name}</strong></p>
            <p className="cds--label">CLIENT ID</p>
            <CodeSnippet type="single" feedback="Client ID copied">{issuedCredential.clientId}</CodeSnippet>
            <p className="cds--label" style={{ marginTop: 'var(--spacing-4)' }}>CLIENT SECRET</p>
            <CodeSnippet type="multi" feedback="Client secret copied" maxCollapsedNumberOfRows={4} maxExpandedNumberOfRows={8}>{issuedCredential.token}</CodeSnippet>
            <p className="cds--label" style={{ marginTop: 'var(--spacing-4)' }}>TOKEN ENDPOINT</p>
            <CodeSnippet type="single" feedback="Token endpoint copied">{`${window.location.origin}${issuedCredential.tokenEndpointPath}`}</CodeSnippet>
            <p className="eg-secondary-text" style={{ marginTop: 'var(--spacing-3)' }}>Stored fingerprint: {issuedCredential.credential.fingerprint}</p>
            <Checkbox
              id="provisioning-credential-stored"
              labelText="I have stored the client secret in the approved secret manager"
              checked={credentialStored}
              onChange={(_event, data) => setCredentialStored(Boolean(data.checked))}
            />
          </>
        )}
      </Modal>

      <ConfirmModal
        open={archiveModal.isOpen}
        onClose={archiveModal.closeModal}
        onConfirm={archiveDirectory}
        title="Archive provisioning directory"
        description={`Archive ${archiveModal.data?.displayName || 'this directory'} and immediately revoke all associated credentials? Provisioned user records and audit history are retained.`}
        confirmText="Archive directory"
        danger
        busy={busy}
        showWarning
        warningMessage="The SCIM endpoint will stop accepting every credential for this directory."
      />
      <ConfirmModal
        open={revokeModal.isOpen}
        onClose={revokeModal.closeModal}
        onConfirm={revokeCredential}
        title="Revoke provisioning credential"
        description={`Revoke ${revokeModal.data?.name || 'this credential'} immediately?`}
        confirmText="Revoke credential"
        danger
        busy={busy}
      />
    </div>
  );
}
