import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CamundaNativeGrantInventoryService,
  classifyCamundaNativeGrant,
} from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantInventoryService.js';

// The fixture intentionally stays plain JavaScript because it is also used by
// the disposable mock-Camunda process outside Vitest.
// @ts-expect-error No declaration is needed for the shared test fixture.
import { createMockCamundaHandler } from '../../../../../test/e2e/mock-camunda/server-handler.mjs';

const servers: http.Server[] = [];

async function withMockCamunda<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer(createMockCamundaHandler());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock Camunda server did not bind a TCP port');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    servers.splice(servers.indexOf(server), 1);
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('synthetic Camunda 7 native-grant fixture integration', () => {
  it('reads the full translation matrix over GET only and classifies supported, manual, and fail-closed rows', async () => {
    await withMockCamunda(async (baseUrl) => {
      const inventory = await new CamundaNativeGrantInventoryService(async (_engineId, page) => {
        const response = await fetch(`${baseUrl}/engine-rest/authorization?${new URLSearchParams({
          firstResult: String(page.firstResult),
          maxResults: String(page.maxResults),
        })}`);
        expect(response.status).toBe(200);
        return response.json();
      }).listLive('synthetic-engine', { pageSize: 4, maxRecords: 100 });

      expect(inventory).toMatchObject({ truncated: false });
      expect(inventory.authorizations).toHaveLength(12);
      const runtimeResources = [
        { resourceKind: 'process_definition' as const, resourceKey: 'invoice-process', runtimeTenantId: 'runtime-blue', isActive: true, tenantResolutionStatus: 'resolved' as const },
        { resourceKind: 'decision_definition' as const, resourceKey: 'invoice-risk', runtimeTenantId: 'runtime-blue', isActive: true, tenantResolutionStatus: 'resolved' as const },
      ];
      const results = Object.fromEntries(inventory.authorizations.map((authorization) => {
        const classification = classifyCamundaNativeGrant(authorization, { runtimeResources, requireResolvedTenant: true });
        return [authorization.id, { disposition: classification.disposition, reasonCodes: classification.reasonCodes }];
      }));

      expect(results).toEqual({
        'synthetic-grant-process-read': { disposition: 'proposed', reasonCodes: ['group_grant_process_definition'] },
        'synthetic-grant-decision-read': { disposition: 'proposed', reasonCodes: ['group_grant_decision_definition'] },
        'synthetic-grant-process-broad': { disposition: 'approval_required', reasonCodes: ['broad_resource_acknowledgement_required', 'group_grant_process_definition'] },
        'synthetic-grant-decision-broad': { disposition: 'approval_required', reasonCodes: ['broad_resource_acknowledgement_required', 'group_grant_decision_definition'] },
        'synthetic-user-grant': { disposition: 'manual_required', reasonCodes: ['user_identity_mapping_required'] },
        'synthetic-global-grant': { disposition: 'manual_required', reasonCodes: ['global_authorization_not_convertible'] },
        'synthetic-group-revoke': { disposition: 'manual_required', reasonCodes: ['revoke_authorization_not_convertible'] },
        'synthetic-task-grant': { disposition: 'manual_required', reasonCodes: ['unsupported_resource_type'] },
        'synthetic-process-create': { disposition: 'blocked', reasonCodes: ['permission_mapping_not_supported'] },
        'synthetic-missing-group': { disposition: 'manual_required', reasonCodes: ['missing_group_principal'] },
        'synthetic-missing-resource-id': { disposition: 'blocked', reasonCodes: ['missing_resource_id'] },
        'synthetic-missing-runtime-resource': { disposition: 'blocked', reasonCodes: ['runtime_resource_not_found'] },
      });

      const ledger = await (await fetch(`${baseUrl}/__e2e/requests`)).json() as { requests: Array<{ request: string }> };
      expect(ledger.requests).toHaveLength(1);
      expect(ledger.requests[0]).toEqual({ request: 'GET /engine-rest/authorization', count: 4 });
    });
  });
});
