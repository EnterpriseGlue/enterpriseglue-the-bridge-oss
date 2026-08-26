import React from 'react';
import { HeaderMenu, HeaderMenuItem } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../../../shared/api/client';

interface TenantMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended' | 'deleting';
  role: 'admin' | 'member';
}

export default function NativeTenantPicker({ enabled }: { enabled: boolean }) {
  const location = useLocation();
  const match = location.pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  const activeSlug = match?.[1] ? decodeURIComponent(match[1]) : '';
  const suffix = match?.[2] || '';
  const memberships = useQuery({
    queryKey: ['native-tenant-memberships'],
    queryFn: () => apiClient.get<TenantMembership[]>('/api/auth/my-tenants'),
    enabled,
  });
  const tenantDestination = (tenant: TenantMembership) =>
    `/t/${encodeURIComponent(tenant.tenantSlug)}${suffix}${location.search}${location.hash}`;
  const switchTenant = async (tenant: TenantMembership) => {
    await apiClient.post('/api/auth/switch-tenant', { tenantSlug: tenant.tenantSlug });
    window.location.assign(tenantDestination(tenant));
  };
  if (!enabled) return null;
  const active = memberships.data?.find((tenant) => tenant.tenantSlug === activeSlug);
  return (
    <HeaderMenu menuLinkName={active?.tenantName || 'Select tenant'}>
      {(memberships.data || []).filter((tenant) => tenant.tenantStatus === 'active').map((tenant) => (
        <HeaderMenuItem
          key={tenant.tenantId}
          href={tenantDestination(tenant)}
          onClick={(event) => {
            event.preventDefault();
            void switchTenant(tenant);
          }}
        >
          {tenant.tenantName}
        </HeaderMenuItem>
      ))}
    </HeaderMenu>
  );
}
