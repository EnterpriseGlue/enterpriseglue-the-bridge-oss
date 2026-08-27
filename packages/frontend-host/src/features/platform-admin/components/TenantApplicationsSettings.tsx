import React from 'react';
import {
  Button,
  InlineNotification,
  Stack,
  Tag,
  Tile,
} from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PluginTenantApplicationV1 } from '@enterpriseglue/plugin-sdk';

import {
  decideTenantApplicationActivation,
  listTenantApplications,
  requestTenantApplicationActivation,
  setTenantApplicationActive,
} from '../api/tenantApplications';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useActionDecision } from '../../../shared/auth/guards';

function idempotencyKey(action: string): string {
  return `${action}-${crypto.randomUUID()}`;
}

function statusTag(status: PluginTenantApplicationV1['status']) {
  if (status === 'active') return 'green';
  if (status === 'requested' || status === 'install-pending') return 'blue';
  if (status === 'blocked' || status === 'revoked') return 'red';
  return 'gray';
}

export default function TenantApplicationsSettings(props: {
  tenantId: string | null;
  tenantSlug: string;
}) {
  const tenantResource = React.useMemo(
    () => ({ type: 'tenant' as const, id: props.tenantId }),
    [props.tenantId],
  );
  const read = useActionDecision('tenant.apps.read', tenantResource);
  const request = useActionDecision('tenant.apps.request', tenantResource);
  const manage = useActionDecision('tenant.apps.manage', tenantResource);
  const use = useActionDecision('tenant.apps.use', tenantResource);
  const queryClient = useQueryClient();
  const [error, setError] = React.useState('');
  const catalogue = useQuery({
    queryKey: ['tenant-applications', props.tenantSlug],
    queryFn: () => listTenantApplications(props.tenantSlug),
    enabled: read.allowed && Boolean(props.tenantSlug),
  });
  const refresh = () => queryClient.invalidateQueries({
    queryKey: ['tenant-applications', props.tenantSlug],
  });
  const activeMutation = useMutation({
    mutationFn: (input: { application: PluginTenantApplicationV1; active: boolean }) =>
      setTenantApplicationActive({
        tenantSlug: props.tenantSlug,
        pluginId: input.application.pluginId,
        active: input.active,
        expectedRevision: input.application.revision,
        idempotencyKey: idempotencyKey(input.active ? 'activate' : 'deactivate'),
      }),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (value: unknown) => setError(parseApiError(value, 'Application state was not changed').message),
  });
  const requestMutation = useMutation({
    mutationFn: (application: PluginTenantApplicationV1) =>
      requestTenantApplicationActivation({
        tenantSlug: props.tenantSlug,
        pluginId: application.pluginId,
        expectedRevision: application.revision,
        idempotencyKey: idempotencyKey('activation-request'),
      }),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (value: unknown) => setError(parseApiError(value, 'Activation was not requested').message),
  });
  const decisionMutation = useMutation({
    mutationFn: (input: { application: PluginTenantApplicationV1; decision: 'approve' | 'reject' }) =>
      decideTenantApplicationActivation({
        tenantSlug: props.tenantSlug,
        pluginId: input.application.pluginId,
        decision: input.decision,
        expectedRevision: input.application.revision,
        idempotencyKey: idempotencyKey(`activation-${input.decision}`),
      }),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (value: unknown) => setError(parseApiError(value, 'Activation request was not decided').message),
  });

  if (!read.allowed) return null;
  return (
    <Tile>
      <Stack gap={5}>
        <div>
          <h2 style={{ marginTop: 0 }}>Applications</h2>
          <p>Use applications installed by the platform operator and control activation only for this organization.</p>
        </div>
        {error && <InlineNotification kind="error" title="Application marketplace" subtitle={error} lowContrast />}
        {catalogue.isError && <InlineNotification kind="error" title="Applications unavailable" subtitle={parseApiError(catalogue.error, 'The application catalogue could not be loaded').message} lowContrast />}
        {!catalogue.isLoading && (catalogue.data?.applications.length ?? 0) === 0 && (
          <InlineNotification kind="info" title="No applications available" subtitle="A platform operator must install a tenant-compatible application before it appears here." lowContrast hideCloseButton />
        )}
        {(catalogue.data?.applications ?? []).map((application) => (
          <div key={application.pluginId} style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-4)' }}>
            <Stack gap={3}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <strong>{application.displayName}</strong>
                  <div style={{ color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>{application.publisher} · {application.version}</div>
                </div>
                <Tag type={statusTag(application.status)}>{application.status}</Tag>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {use.allowed && application.active && application.configuration.href && (
                  <Button size="sm" kind="tertiary" href={application.configuration.href}>Configure</Button>
                )}
                {manage.allowed && catalogue.data?.activationPolicy === 'direct' && !application.active && !['blocked', 'revoked', 'install-pending'].includes(application.status) && (
                  <Button size="sm" disabled={activeMutation.isPending} onClick={() => activeMutation.mutate({ application, active: true })}>Activate</Button>
                )}
                {manage.allowed && application.active && (
                  <Button size="sm" kind="danger--tertiary" disabled={activeMutation.isPending} onClick={() => activeMutation.mutate({ application, active: false })}>Deactivate</Button>
                )}
                {catalogue.data?.activationPolicy === 'approval_required' && request.allowed && !application.active && application.status !== 'requested' && !['blocked', 'revoked', 'install-pending'].includes(application.status) && (
                  <Button size="sm" kind="tertiary" disabled={requestMutation.isPending} onClick={() => requestMutation.mutate(application)}>Request activation</Button>
                )}
                {catalogue.data?.activationPolicy === 'approval_required' && manage.allowed && application.status === 'requested' && (
                  <>
                    <Button size="sm" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ application, decision: 'approve' })}>Approve</Button>
                    <Button size="sm" kind="danger--tertiary" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ application, decision: 'reject' })}>Reject</Button>
                  </>
                )}
              </div>
            </Stack>
          </div>
        ))}
      </Stack>
    </Tile>
  );
}
