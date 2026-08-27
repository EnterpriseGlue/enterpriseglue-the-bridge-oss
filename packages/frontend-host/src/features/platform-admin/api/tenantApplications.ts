import type {
  PluginTenantApplicationAuditListV1,
  PluginTenantApplicationListV1,
  PluginTenantApplicationV1,
} from '@enterpriseglue/plugin-sdk';

import { apiClient } from '../../../shared/api/client';

function basePath(tenantSlug: string): string {
  return `/api/t/${encodeURIComponent(tenantSlug)}/apps`;
}

export function listTenantApplications(
  tenantSlug: string,
): Promise<PluginTenantApplicationListV1> {
  return apiClient.get(basePath(tenantSlug), undefined, {
    credentials: 'include',
  });
}

export function setTenantApplicationActive(input: {
  tenantSlug: string;
  pluginId: string;
  active: boolean;
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<PluginTenantApplicationV1> {
  return apiClient.post(
    `${basePath(input.tenantSlug)}/${encodeURIComponent(input.pluginId)}/${input.active ? 'activate' : 'deactivate'}`,
    {
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    },
    { credentials: 'include' },
  );
}

export function requestTenantApplicationActivation(input: {
  tenantSlug: string;
  pluginId: string;
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<PluginTenantApplicationV1> {
  return apiClient.post(
    `${basePath(input.tenantSlug)}/${encodeURIComponent(input.pluginId)}/activation-request`,
    {
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    },
    { credentials: 'include' },
  );
}

export function decideTenantApplicationActivation(input: {
  tenantSlug: string;
  pluginId: string;
  decision: 'approve' | 'reject';
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<PluginTenantApplicationV1> {
  return apiClient.post(
    `${basePath(input.tenantSlug)}/${encodeURIComponent(input.pluginId)}/activation-request/decision`,
    {
      decision: input.decision,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    },
    { credentials: 'include' },
  );
}

export function listTenantApplicationAudit(input: {
  tenantSlug: string;
  pluginId: string;
}): Promise<PluginTenantApplicationAuditListV1> {
  return apiClient.get(
    `${basePath(input.tenantSlug)}/${encodeURIComponent(input.pluginId)}/audit`,
    undefined,
    { credentials: 'include' },
  );
}
