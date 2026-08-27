import React from 'react';
import { Button, Form, InlineNotification, Select, SelectItem, Stack, Tag, TextInput, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import IdentityProvidersSettingsTab from '../components/IdentityProvidersSettingsTab';
import TenantApplicationsSettings from '../components/TenantApplicationsSettings';
import { apiClient } from '../../../shared/api/client';
import { fetchList } from '../../../shared/api/fetchList';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useParams } from 'react-router-dom';
import { UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { useAuth } from '../../../shared/hooks/useAuth';

interface TenantLoginPolicy {
  localPasswordMode: 'auto' | 'enabled' | 'disabled';
  providerSelectionMode: 'auto_redirect_single' | 'chooser' | 'progressive';
}

interface TenantMember {
  userId: string;
  email: string;
  role: 'admin' | 'member';
}

interface TenantDiscoveryDomain {
  id: string;
  tenantId: string;
  domain: string;
  status: 'pending' | 'verified' | 'disabled';
  verifiedAt: number | null;
}

interface TenantDiscoveryDomainCreateResponse {
  domain: TenantDiscoveryDomain;
  verificationToken: string;
  dnsRecord: { name: string; type: 'TXT'; value: string };
}

const tenantRoleLabels: Record<TenantMember['role'], string> = {
  admin: 'Tenant administrator',
  member: 'Member',
};

export default function TenantSettingsPage() {
  const { tenantSlug = '' } = useParams();
  const { permissions } = useAuth();
  const tenantId = permissions?.tenant?.resourceId || permissions?.tenantId || null;
  const tenantResource = React.useMemo(() => ({ type: 'tenant' as const, id: tenantId }), [tenantId]);
  const settingsRead = useActionDecision('tenant.settings.read', tenantResource);
  const settingsManage = useActionDecision('tenant.settings.manage', tenantResource);
  const membersManage = useActionDecision('tenant.members.manage', tenantResource);
  const policyPath = `/api/t/${encodeURIComponent(tenantSlug)}/tenant/login-policy`;
  const membersPath = `/api/t/${encodeURIComponent(tenantSlug)}/tenant/members`;
  const discoveryDomainsPath = `/api/t/${encodeURIComponent(tenantSlug)}/tenant/discovery-domains`;
  const queryClient = useQueryClient();
  const [error, setError] = React.useState('');
  const [memberUserId, setMemberUserId] = React.useState('');
  const [memberRole, setMemberRole] = React.useState<TenantMember['role']>('member');
  const [discoveryDomain, setDiscoveryDomain] = React.useState('');
  const [pendingDiscoveryVerification, setPendingDiscoveryVerification] = React.useState<TenantDiscoveryDomainCreateResponse | null>(null);
  const policy = useQuery({
    queryKey: ['tenant-login-policy', tenantSlug],
    queryFn: () => apiClient.get<TenantLoginPolicy>(policyPath),
    enabled: settingsManage.allowed,
  });
  const members = useQuery({
    queryKey: ['tenant-members', tenantSlug],
    queryFn: () => fetchList<TenantMember>(membersPath),
    enabled: membersManage.allowed,
  });
  const discoveryDomains = useQuery({
    queryKey: ['tenant-discovery-domains', tenantSlug],
    queryFn: () => fetchList<TenantDiscoveryDomain>(discoveryDomainsPath),
    enabled: settingsManage.allowed,
  });
  const updatePolicy = useMutation({
    mutationFn: (update: Partial<{ localPasswordLoginMode: TenantLoginPolicy['localPasswordMode']; ssoProviderSelectionMode: TenantLoginPolicy['providerSelectionMode'] }>) => {
      const current = policy.data || { localPasswordMode: 'auto' as const, providerSelectionMode: 'chooser' as const };
      return apiClient.put<TenantLoginPolicy>(policyPath, {
        localPasswordMode: update.localPasswordLoginMode || current.localPasswordMode,
        providerSelectionMode: update.ssoProviderSelectionMode || current.providerSelectionMode,
      });
    },
    onSuccess: async () => { setError(''); await queryClient.invalidateQueries({ queryKey: ['tenant-login-policy', tenantSlug] }); },
    onError: (value: unknown) => setError(parseApiError(value, 'Sign-in policy was not saved').message),
  });
  const upsertMember = useMutation({
    mutationFn: () => apiClient.put(`${membersPath}/${encodeURIComponent(memberUserId.trim())}`, { role: memberRole }),
    onSuccess: async () => {
      setError('');
      setMemberUserId('');
      await queryClient.invalidateQueries({ queryKey: ['tenant-members', tenantSlug] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Tenant membership was not saved').message),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`${membersPath}/${encodeURIComponent(userId)}`),
    onSuccess: async () => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['tenant-members', tenantSlug] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Tenant membership was not removed').message),
  });
  const createDiscoveryDomain = useMutation({
    mutationFn: (domain: string) => apiClient.post<TenantDiscoveryDomainCreateResponse>(discoveryDomainsPath, { domain: domain.trim().toLowerCase() }),
    onSuccess: async (result) => {
      setError('');
      setDiscoveryDomain('');
      setPendingDiscoveryVerification(result);
      await queryClient.invalidateQueries({ queryKey: ['tenant-discovery-domains', tenantSlug] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Organization discovery domain was not saved').message),
  });
  const verifyDiscoveryDomain = useMutation({
    mutationFn: () => apiClient.post<TenantDiscoveryDomain>(
      `${discoveryDomainsPath}/${encodeURIComponent(pendingDiscoveryVerification!.domain.id)}/verify`,
      { verificationToken: pendingDiscoveryVerification!.verificationToken },
    ),
    onSuccess: async () => {
      setError('');
      setPendingDiscoveryVerification(null);
      await queryClient.invalidateQueries({ queryKey: ['tenant-discovery-domains', tenantSlug] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'DNS verification did not succeed').message),
  });
  const disableDiscoveryDomain = useMutation({
    mutationFn: (domainId: string) => apiClient.delete(`${discoveryDomainsPath}/${encodeURIComponent(domainId)}`),
    onSuccess: async () => {
      setError('');
      setPendingDiscoveryVerification(null);
      await queryClient.invalidateQueries({ queryKey: ['tenant-discovery-domains', tenantSlug] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Organization discovery domain was not disabled').message),
  });
  if (!settingsRead.allowed) {
    return <UnauthorizedEmptyState title="Tenant settings unavailable" reason={settingsRead.reason || 'Missing tenant settings permission.'} />;
  }
  return (
    <main style={{ padding: 'clamp(1rem, 3vw, 2rem)', maxWidth: 1120, width: '100%' }}>
      <Stack gap={7}>
        <div>
          <h1>Tenant sign-in and identity</h1>
          <p>Configure this tenant’s members, local login policy, and its own OIDC, SAML, or LDAP providers.</p>
        </div>
        {error && <InlineNotification kind="error" title="Tenant settings were not changed" subtitle={error} lowContrast />}
        <TenantApplicationsSettings tenantId={tenantId} tenantSlug={tenantSlug} />
        {membersManage.allowed && <Tile>
          <Stack gap={5}>
            <div><h2 style={{ marginTop: 0 }}>Members</h2><p>Grant an existing EnterpriseGlue account access to this organization.</p></div>
            <Form onSubmit={(event) => { event.preventDefault(); if (memberUserId.trim()) upsertMember.mutate(); }}>
              <Stack gap={4}>
                <TextInput id="tenant-member-user-id" labelText="Account ID" value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required />
                <Select id="tenant-member-role" labelText="Tenant role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as TenantMember['role'])}>
                  <SelectItem value="member" text="Member" />
                  <SelectItem value="admin" text="Tenant administrator" />
                </Select>
                <Button type="submit" disabled={!memberUserId.trim() || upsertMember.isPending}>Add or update member</Button>
              </Stack>
            </Form>
            <Stack gap={3}>
              {(members.data || []).map((member) => <div key={member.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{member.email} · {tenantRoleLabels[member.role]}</span>
                <Button kind="danger--ghost" size="sm" disabled={removeMember.isPending} onClick={() => removeMember.mutate(member.userId)}>Remove</Button>
              </div>)}
            </Stack>
          </Stack>
        </Tile>}
        {settingsManage.allowed && <Tile>
          <Stack gap={5}>
            <div>
              <h2 style={{ marginTop: 0 }}>Organization discovery</h2>
              <p>Let members find this organization from a DNS-verified work-email domain. Discovery never grants membership or bypasses this tenant’s login policy.</p>
            </div>
            <Form onSubmit={(event) => { event.preventDefault(); if (discoveryDomain.trim()) createDiscoveryDomain.mutate(discoveryDomain); }}>
              <Stack gap={4}>
                <TextInput
                  id="tenant-discovery-domain"
                  labelText="Work-email domain"
                  helperText="Use a company-controlled domain such as example.com. Consumer email domains are not accepted."
                  placeholder="example.com"
                  value={discoveryDomain}
                  onChange={(event) => setDiscoveryDomain(event.target.value.toLowerCase())}
                  required
                />
                <Button type="submit" disabled={!discoveryDomain.trim() || createDiscoveryDomain.isPending}>Add and verify domain</Button>
              </Stack>
            </Form>
            {pendingDiscoveryVerification && <div style={{ overflowWrap: 'anywhere' }}>
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title={`Verify ${pendingDiscoveryVerification.domain.domain}`}
                subtitle={`Create TXT ${pendingDiscoveryVerification.dnsRecord.name} with value ${pendingDiscoveryVerification.dnsRecord.value}, then check DNS.`}
              />
              <Button size="sm" kind="ghost" disabled={verifyDiscoveryDomain.isPending} onClick={() => verifyDiscoveryDomain.mutate()}>Check DNS</Button>
            </div>}
            <Stack gap={3}>
              {(discoveryDomains.data || []).map((domain) => <div key={domain.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                  <span>{domain.domain}</span>
                  <Tag type={domain.status === 'verified' ? 'green' : domain.status === 'pending' ? 'blue' : 'gray'}>{domain.status}</Tag>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {domain.status === 'pending' && <Button kind="ghost" size="sm" disabled={createDiscoveryDomain.isPending} onClick={() => createDiscoveryDomain.mutate(domain.domain)}>Restart verification</Button>}
                  {domain.status !== 'disabled' && <Button kind="danger--ghost" size="sm" disabled={disableDiscoveryDomain.isPending} onClick={() => disableDiscoveryDomain.mutate(domain.id)}>Disable</Button>}
                </span>
              </div>)}
            </Stack>
          </Stack>
        </Tile>}
        <IdentityProvidersSettingsTab
          tenantAdminMode
          tenantId={tenantId}
          loginPolicy={policy.data ? {
            localPasswordLoginMode: policy.data.localPasswordMode,
            ssoProviderSelectionMode: policy.data.providerSelectionMode,
          } : null}
          canManageLoginPolicy={settingsManage.allowed}
          loginPolicyUnavailableReason={settingsManage.reason}
          onLoginPolicyChange={(update) => updatePolicy.mutate(update)}
        />
      </Stack>
    </main>
  );
}
