import React, { useState } from 'react';
import { Button, Form, InlineNotification, Stack, TextInput, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { fetchList } from '../../../shared/api/fetchList';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useAuth } from '../../../shared/hooks/useAuth';
import { UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleting';
  placementKey: string | null;
  placementEpoch: number;
}

export default function TenantsPage() {
  const { user } = useAuth();
  const readDecision = useActionDecision('platform.tenants.read', { type: 'platform' });
  const manageDecision = useActionDecision('platform.tenants.manage', { type: 'platform' });
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState('');
  const tenants = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => fetchList<Tenant>('/api/platform/tenants'),
    enabled: readDecision.allowed,
  });
  const createTenant = useMutation({
    mutationFn: () => apiClient.post<Tenant>('/api/platform/tenants', { name, slug, ownerUserId: user!.id }),
    onSuccess: async (tenant) => {
      await queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      await queryClient.invalidateQueries({ queryKey: ['native-tenant-memberships'] });
      await apiClient.post('/api/auth/switch-tenant', { tenantSlug: tenant.slug });
      window.location.assign(`/t/${encodeURIComponent(tenant.slug)}`);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Tenant creation failed').message),
  });
  if (!readDecision.allowed) {
    return <UnauthorizedEmptyState title="Tenants unavailable" reason={readDecision.reason || 'Missing tenant lifecycle read permission.'} />;
  }
  return (
    <main style={{ padding: 'clamp(1rem, 3vw, 2rem)', maxWidth: 960, width: '100%' }}>
      <Stack gap={7}>
        <div><h1>Tenants</h1><p>Create and place customer organizations on this pooled deployment.</p></div>
        {error && <InlineNotification kind="error" title="Tenant was not created" subtitle={error} lowContrast />}
        <Tile>
          <Form onSubmit={(event) => { event.preventDefault(); if (!manageDecision.allowed) return; setError(''); createTenant.mutate(); }}>
            <Stack gap={5}>
              <TextInput id="tenant-name" labelText="Tenant name" value={name} onChange={(event) => { setName(event.target.value); if (!slugEdited) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} required />
              <TextInput id="tenant-slug" labelText="Tenant slug" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase()); }} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required />
              <Button type="submit" disabled={!user || !manageDecision.allowed || createTenant.isPending} title={manageDecision.allowed ? undefined : manageDecision.reason}>Create tenant</Button>
            </Stack>
          </Form>
        </Tile>
        <Stack gap={4}>
          {(tenants.data || []).map((tenant) => (
            <Tile key={tenant.id}>
              <h3>{tenant.name}</h3>
              <p style={{ overflowWrap: 'anywhere' }}>{tenant.slug} · {tenant.status} · {tenant.placementKey || 'unplaced'} (epoch {tenant.placementEpoch})</p>
              {tenant.status === 'active' && <Button kind="ghost" onClick={async () => {
                await apiClient.post('/api/auth/switch-tenant', { tenantSlug: tenant.slug });
                window.location.assign(`/t/${encodeURIComponent(tenant.slug)}`);
              }}>Open tenant</Button>}
            </Tile>
          ))}
        </Stack>
      </Stack>
    </main>
  );
}
