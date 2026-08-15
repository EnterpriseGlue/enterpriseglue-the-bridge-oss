import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Button,
  Callout,
  DataTableSkeleton,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
} from '@carbon/react';
import { ArrowLeft, Renew, Security, UserAvatar } from '@carbon/icons-react';
import type {
  UserAuditResponse,
  UserEffectiveAccessResponse,
  UserIdentityContext,
  UserSessionsResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/user-directory.js';
import { userDirectoryApi } from '../../api/platform-admin/userDirectory';
import { PageHeader, PageLayout, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import ConfirmModal from '../../shared/components/ConfirmModal';
import { evaluateActionSnapshot } from '../../shared/auth/guards';
import { useAuth } from '../../shared/hooks/useAuth';
import { useModal } from '../../shared/hooks/useModal';
import { useTenantNavigate } from '../../shared/hooks/useTenantNavigate';
import { useToast } from '../../shared/notifications/ToastProvider';
import { parseApiError } from '../../shared/api/apiErrorUtils';

type LifecycleAction = 'deactivate' | 'reactivate' | 'revoke-sessions';

function formatTimestamp(value: number | null | undefined): string {
  return value == null ? 'Never' : new Date(Number(value)).toLocaleString();
}

function sourceLabel(value: string): string {
  const labels: Record<string, string> = {
    none: 'None',
    local: 'Local password',
    oidc: 'OpenID Connect',
    saml: 'SAML',
    ldap: 'LDAP',
    recovery: 'Recovery access',
    jit: 'Just-in-time',
    scim: 'SCIM 2.0',
  };
  return labels[value] || value;
}

function fieldLabel(value: string): string {
  const labels: Record<string, string> = {
    email: 'Email',
    firstName: 'First name',
    lastName: 'Last name',
    displayName: 'Display name',
    active: 'Active state',
  };
  return labels[value] || value;
}

function statusTagType(status: string): 'green' | 'blue' | 'red' | 'warm-gray' {
  if (status === 'active' || status === 'healthy' || status === 'success') return 'green';
  if (status === 'invited' || status === 'locked' || status === 'warning' || status === 'partial') return 'blue';
  if (status === 'deactivated' || status === 'failed' || status === 'failure' || status === 'denied') return 'red';
  return 'warm-gray';
}

function DefinitionGrid({ children }: { children: React.ReactNode }) {
  return <dl className="eg-user-detail-grid">{children}</dl>;
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="eg-user-detail-definition">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function UserDetail() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { tenantNavigate } = useTenantNavigate();
  const { user: currentUser, permissions } = useAuth();
  const { notify } = useToast();
  const actionModal = useModal<LifecycleAction>();
  const [identity, setIdentity] = React.useState<UserIdentityContext | null>(null);
  const [access, setAccess] = React.useState<UserEffectiveAccessResponse | null>(null);
  const [sessions, setSessions] = React.useState<UserSessionsResponse | null>(null);
  const [audit, setAudit] = React.useState<UserAuditResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mutationPending, setMutationPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const platformResource = { type: 'platform' as const, id: null };
  const canDeactivate = evaluateActionSnapshot(permissions, 'platform.users.deactivate', platformResource).allowed;
  const canUpdate = evaluateActionSnapshot(permissions, 'platform.users.update', platformResource).allowed;

  const load = React.useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [nextIdentity, nextAccess, nextSessions, nextAudit] = await Promise.all([
        userDirectoryApi.identityContext(userId),
        userDirectoryApi.effectiveAccess(userId),
        userDirectoryApi.sessions(userId),
        userDirectoryApi.audit(userId),
      ]);
      setIdentity(nextIdentity);
      setAccess(nextAccess);
      setSessions(nextSessions);
      setAudit(nextAudit);
    } catch (loadError) {
      setError(parseApiError(loadError, 'Failed to load the user record').message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  React.useEffect(() => { void load(); }, [load]);

  const executeLifecycleAction = async (reason?: string) => {
    const action = actionModal.data;
    if (!action || !reason || !userId) return;
    setMutationPending(true);
    try {
      if (action === 'deactivate') await userDirectoryApi.deactivate(userId, reason);
      if (action === 'reactivate') await userDirectoryApi.reactivate(userId, reason);
      if (action === 'revoke-sessions') await userDirectoryApi.revokeSessions(userId, reason);
      notify({
        kind: 'success',
        title: action === 'deactivate' ? 'User deactivated' : action === 'reactivate' ? 'User reactivated' : 'Sessions revoked',
        subtitle: 'The reason and resulting lifecycle change were recorded in the audit trail.',
      });
      actionModal.closeModal();
      await load();
    } catch (mutationError) {
      const parsed = parseApiError(mutationError, 'The user lifecycle action failed');
      notify({ kind: 'error', title: 'Action failed', subtitle: parsed.message });
    } finally {
      setMutationPending(false);
    }
  };

  const user = identity?.user;
  const directoryManaged = user?.provisioningSource === 'scim' || user?.provisioningSource === 'ldap';
  const isSelf = currentUser?.id === userId;
  const modalCopy = actionModal.data === 'deactivate'
    ? { title: 'Deactivate user', text: 'Deactivate this EnterpriseGlue account and immediately invalidate all current sessions?', button: 'Deactivate', danger: true }
    : actionModal.data === 'reactivate'
      ? { title: 'Reactivate user', text: 'Restore access for this locally managed account?', button: 'Reactivate', danger: false }
      : { title: 'Revoke all sessions', text: 'Invalidate every current refresh session for this user?', button: 'Revoke sessions', danger: true };

  return (
    <PageLayout style={{ background: 'var(--cds-background)', minHeight: '100vh' }}>
      <Button kind="ghost" size="sm" renderIcon={ArrowLeft} onClick={() => tenantNavigate('/admin/users')}>
        Back to users
      </Button>
      <div className="eg-user-detail-page-header">
        <PageHeader
          icon={UserAvatar}
          title={user?.displayName || user?.email || 'User details'}
          subtitle={user?.email || 'Identity, provisioning, access, sessions, and audit'}
          gradient={PAGE_GRADIENTS.red}
          variant="productive"
          actions={user ? (
            <>
              {canUpdate && (
                <Button kind="secondary" renderIcon={Renew} onClick={() => actionModal.openModal('revoke-sessions')}>
                  Revoke sessions
                </Button>
              )}
              {user.status === 'deactivated' ? (
                canUpdate && (
                  <Button
                    kind="primary"
                    disabled={directoryManaged}
                    title={directoryManaged ? 'Reactivate this identity in its authoritative directory.' : undefined}
                    onClick={() => actionModal.openModal('reactivate')}
                  >
                    Reactivate
                  </Button>
                )
              ) : (
                canDeactivate && !isSelf && (
                  <Button kind="danger" onClick={() => actionModal.openModal('deactivate')}>Deactivate</Button>
                )
              )}
            </>
          ) : undefined}
        />
      </div>

      {error && <InlineNotification kind="error" title="User details unavailable" subtitle={error} hideCloseButton />}
      {loading && <DataTableSkeleton showHeader={false} showToolbar={false} columnCount={4} rowCount={6} />}

      {!loading && user && (
        <>
          {directoryManaged && (
            <Callout
              kind="info"
              lowContrast
              title="Directory-managed identity"
              subtitle="Profile and active-state changes originate in the authoritative provisioning directory. Emergency deactivation remains available here; reactivation must occur at the source."
              actionButtonLabel="Manage provisioning"
              onActionButtonClick={() => tenantNavigate('/admin/settings/identity-provisioning')}
              style={{ maxWidth: 'none', width: '100%' }}
            />
          )}

          <div className="eg-user-detail-tabs">
          <Tabs>
            <TabList aria-label="User record sections" contained>
              <Tab>Overview</Tab>
              <Tab>Linked identities</Tab>
              <Tab>Effective access</Tab>
              <Tab>Sessions</Tab>
              <Tab>Audit</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <Tile>
                  <DefinitionGrid>
                    <Definition term="Status"><Tag type={statusTagType(user.status)}>{user.status}</Tag></Definition>
                    <Definition term="Authentication">{user.authenticationSources.map(sourceLabel).join(', ')}</Definition>
                    <Definition term="Provisioning">{sourceLabel(user.provisioningSource)}</Definition>
                    <Definition term="Provisioning directory">{user.provisioningDirectoryKey || 'Not applicable'}</Definition>
                    <Definition term="Platform access">{user.platformRole}</Definition>
                    <Definition term="Last sign-in">{formatTimestamp(user.lastSignInAt)}</Definition>
                    <Definition term="Last provisioned">{formatTimestamp(user.lastProvisionedAt)}</Definition>
                    <Definition term="Provisioning health"><Tag type={statusTagType(user.provisioningHealth)}>{user.provisioningHealth.replace('_', ' ')}</Tag></Definition>
                    <Definition term="Recovery administrator">{identity.recoveryAdministrator ? 'Yes' : 'No'}</Definition>
                  </DefinitionGrid>
                </Tile>
                <section className="eg-user-detail-field-ownership" aria-labelledby="field-ownership-heading">
                  <h2 id="field-ownership-heading" className="eg-user-detail-section-heading">Field ownership</h2>
                  <div className="eg-user-detail-card-grid eg-user-detail-field-ownership-grid">
                    {identity.fieldOwnership.map((entry) => (
                      <Tile key={entry.field}>
                        <strong>{fieldLabel(entry.field)}</strong>
                        <p>{entry.owner === 'directory' ? 'Managed by directory' : 'Managed in EnterpriseGlue'}</p>
                        {entry.sourceKey && <p className="eg-secondary-text">Source: {entry.sourceKey}</p>}
                      </Tile>
                    ))}
                  </div>
                </section>
              </TabPanel>
              <TabPanel>
                {identity.linkedIdentities.length === 0 ? (
                  <InlineNotification kind="info" title="No linked external identities" subtitle="This user currently has no SSO or provisioning-directory links." hideCloseButton />
                ) : (
                  <div className="eg-user-detail-card-grid">
                    {identity.linkedIdentities.map((linked) => (
                      <Tile key={linked.id}>
                        <Tag type={linked.sourceType === 'identity_provider' ? 'purple' : 'teal'}>{linked.sourceType.replace('_', ' ')}</Tag>
                        <h3>{linked.sourceName}</h3>
                        <p><strong>Source key:</strong> {linked.sourceKey}</p>
                        <p><strong>External subject:</strong> {linked.externalSubject}</p>
                        <p><strong>Last seen:</strong> {formatTimestamp(linked.lastSeenAt)}</p>
                      </Tile>
                    ))}
                  </div>
                )}
              </TabPanel>
              <TabPanel>
                <Tile>
                  <p><strong>Compatibility platform role:</strong> {access?.platformRole || user.platformRole}</p>
                  <p className="eg-secondary-text">Evaluated {formatTimestamp(access?.evaluatedAt)}</p>
                </Tile>
                <div className="eg-user-detail-list">
                  {(access?.lineage || []).map((entry, index) => (
                    <Tile key={`${entry.assignmentId}-${index}`}>
                      <Tag type={entry.active ? 'green' : 'warm-gray'}>{entry.active ? 'active' : 'inactive'}</Tag>
                      <h3>{entry.assignmentName}</h3>
                      <p>{entry.assignmentType.replace('_', ' ')} from {entry.sourceType.replace('_', ' ')}</p>
                      {entry.sourceName && <p className="eg-secondary-text">Source: {entry.sourceName}</p>}
                    </Tile>
                  ))}
                  {(access?.lineage || []).length === 0 && <p>No effective access lineage was found.</p>}
                </div>
              </TabPanel>
              <TabPanel>
                <div className="eg-user-detail-list">
                  {(sessions?.sessions || []).map((session) => (
                    <Tile key={session.id}>
                      <Tag type={session.revokedAt ? 'warm-gray' : 'green'}>{session.revokedAt ? 'revoked' : 'active'}</Tag>
                      <h3>{sourceLabel(session.authenticationSource)} session</h3>
                      <p><strong>Last used:</strong> {formatTimestamp(session.lastUsedAt)}</p>
                      <p><strong>Expires:</strong> {formatTimestamp(session.expiresAt)}</p>
                      <p className="eg-secondary-text">{session.ipAddress || 'IP unavailable'} · {session.userAgent || 'Device unavailable'}</p>
                    </Tile>
                  ))}
                  {(sessions?.sessions || []).length === 0 && <p>No current or recent sessions were found.</p>}
                </div>
              </TabPanel>
              <TabPanel>
                <div className="eg-user-detail-list">
                  {(audit?.events || []).map((event) => (
                    <Tile key={event.id}>
                      <Tag type={statusTagType(event.outcome)}>{event.outcome}</Tag>
                      <h3>{event.action}</h3>
                      <p>{event.reason || 'No administrator reason recorded.'}</p>
                      <p className="eg-secondary-text">{formatTimestamp(event.occurredAt)} · Actor {event.actorId || 'system'} · Source {event.sourceType || 'application'}</p>
                    </Tile>
                  ))}
                  {(audit?.events || []).length === 0 && <p>No bounded audit events were found for this user.</p>}
                </div>
              </TabPanel>
            </TabPanels>
          </Tabs>
          </div>
        </>
      )}

      <ConfirmModal
        open={actionModal.isOpen}
        onClose={actionModal.closeModal}
        onConfirm={executeLifecycleAction}
        title={modalCopy.title}
        description={modalCopy.text}
        confirmText={modalCopy.button}
        danger={modalCopy.danger}
        busy={mutationPending}
        requireReason
        reasonMinLength={3}
        reasonDescription="Required for the immutable administrator audit trail (3–500 characters)."
        showWarning={actionModal.data === 'deactivate' || actionModal.data === 'revoke-sessions'}
        warningMessage={actionModal.data === 'deactivate'
          ? 'This immediately invalidates existing sessions. Directory-managed profile data is preserved.'
          : 'Every refresh session will be invalidated; the user must authenticate again.'}
      />
    </PageLayout>
  );
}
