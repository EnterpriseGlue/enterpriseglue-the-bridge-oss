import {
  pluginInstallApprovalV1Schema,
  pluginInstallReviewV1Schema,
  pluginInstallationIntentV1Schema,
  pluginManagerCapabilityV1Schema,
  type PluginInstallReviewV1,
  type PluginInstallationObservationV1,
  type PluginManagerCapabilityV1,
} from '@enterpriseglue/plugin-sdk/manager';

import type {
  ClaimedPluginInstallationIntentV1,
  PluginManagerHostPortV1,
} from './manager.js';

export interface HttpPluginManagerHostOptionsV1 {
  baseUrl: string;
  workloadToken: () => Promise<string>;
  fetch?: typeof fetch;
  maximumResponseBytes?: number;
}

type JsonRecord = Record<string, unknown>;

function assertBaseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('manager_host_base_url_invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function boundedInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`manager_host_${name}_invalid`);
  }
  return Number(value);
}

function boundedString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    throw new Error(`manager_host_${name}_invalid`);
  }
  return value;
}

export class HttpPluginManagerHostV1 implements PluginManagerHostPortV1 {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly maximumResponseBytes: number;

  constructor(private readonly options: HttpPluginManagerHostOptionsV1) {
    this.baseUrl = assertBaseUrl(options.baseUrl);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 1_048_576;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const token = await this.options.workloadToken();
    if (!/^[A-Za-z0-9._~-]{16,4096}$/.test(token)) {
      throw new Error('manager_workload_token_invalid');
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...init.headers,
      },
      redirect: 'error',
    });
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > this.maximumResponseBytes) {
      throw new Error('manager_host_response_too_large');
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > this.maximumResponseBytes) {
      throw new Error('manager_host_response_too_large');
    }
    if (!response.ok) throw new Error(`manager_host_http_${response.status}`);
    return body.length > 0 ? JSON.parse(body) : {};
  }

  async advertiseCapability(capability: PluginManagerCapabilityV1): Promise<void> {
    await this.request('/api/plugin-platform/internal/v1/manager/capability', {
      method: 'PUT',
      body: JSON.stringify(pluginManagerCapabilityV1Schema.parse(capability)),
    });
  }

  async claimIntent(input: {
    managerId: string;
    leaseDurationMs: number;
    occurredAt: string;
  }): Promise<ClaimedPluginInstallationIntentV1 | null> {
    const value = await this.request(
      '/api/plugin-platform/internal/v1/installations:claim',
      { method: 'POST', body: JSON.stringify(input) },
    );
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as JsonRecord).intent === null
    ) {
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('manager_host_claim_invalid');
    }
    const record = value as JsonRecord;
    return {
      intent: pluginInstallationIntentV1Schema.parse(record.intent),
      leaseToken: boundedString(record.leaseToken, 'lease_token'),
      revision: boundedInteger(record.revision, 'revision'),
      leaseExpiresAt: boundedString(record.leaseExpiresAt, 'lease_expiry'),
      review:
        record.review === null || record.review === undefined
          ? undefined
          : pluginInstallReviewV1Schema.parse(record.review),
    };
  }

  async renewIntentLease(input: {
    installationId: string;
    leaseToken: string;
    expectedRevision: number;
    leaseDurationMs: number;
    occurredAt: string;
  }): Promise<{ revision: number; leaseExpiresAt: string }> {
    const value = (await this.request(
      `/api/plugin-platform/internal/v1/installations/${encodeURIComponent(input.installationId)}/lease-renewal`,
      { method: 'POST', body: JSON.stringify(input) },
    )) as JsonRecord;
    return {
      revision: boundedInteger(value.revision, 'revision'),
      leaseExpiresAt: boundedString(value.leaseExpiresAt, 'lease_expiry'),
    };
  }

  async publishReview(input: {
    leaseToken: string;
    expectedRevision: number;
    review: PluginInstallReviewV1;
  }): Promise<{ revision: number; leaseRetained: boolean }> {
    const value = (await this.request(
      `/api/plugin-platform/internal/v1/installations/${encodeURIComponent(input.review.installationId)}/review`,
      { method: 'PUT', body: JSON.stringify(input) },
    )) as JsonRecord;
    if (typeof value.leaseRetained !== 'boolean') {
      throw new Error('manager_host_lease_retained_invalid');
    }
    return {
      revision: boundedInteger(value.revision, 'revision'),
      leaseRetained: value.leaseRetained,
    };
  }

  async readApproval(input: {
    installationId: string;
    reviewSha256: string;
    planSha256: string;
  }) {
    const query = new URLSearchParams({
      reviewSha256: input.reviewSha256,
      planSha256: input.planSha256,
    });
    const value = await this.request(
      `/api/plugin-platform/internal/v1/installations/${encodeURIComponent(input.installationId)}/approval?${query.toString()}`,
      { method: 'GET' },
    );
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as JsonRecord).approval === null
    ) {
      return null;
    }
    const record = value as JsonRecord;
    return {
      approval: pluginInstallApprovalV1Schema.parse(record.approval),
      revision: boundedInteger(record.revision, 'revision'),
    };
  }

  async publishObservation(input: {
    leaseToken: string;
    expectedRevision: number;
    observation: PluginInstallationObservationV1;
  }): Promise<{ revision: number }> {
    const value = (await this.request(
      `/api/plugin-platform/internal/v1/installations/${encodeURIComponent(input.observation.installationId)}/observation`,
      { method: 'PUT', body: JSON.stringify(input) },
    )) as JsonRecord;
    return { revision: boundedInteger(value.revision, 'revision') };
  }
}
