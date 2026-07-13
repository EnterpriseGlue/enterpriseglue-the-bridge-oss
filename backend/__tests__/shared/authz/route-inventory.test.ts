import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  AUTHZ_OPENAPI_EXTENSION_KEY,
  AUTHZ_OPENAPI_EXEMPTION_KEY,
  getAuthzActionDefinition,
  validateAuthzRouteInventory,
} from '@enterpriseglue/shared/authz/index.js';

describe('authorization route inventory validation', () => {
  it('validates generated OpenAPI authz metadata against the action registry', () => {
    const result = validateAuthzRouteInventory(generateOpenApi());

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('validates every public action route in strict OpenAPI mode', () => {
    const result = validateAuthzRouteInventory(generateOpenApi(), { requireOpenApiForActionRoutes: true });

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('documents typed configuration bundle lifecycle contracts', () => {
    const openApi = generateOpenApi();
    const preview = openApi.paths['/api/authz/config-bundles/preview'].post;
    const diff = openApi.paths['/api/authz/config-bundles/diff'].post;
    const apply = openApi.paths['/api/authz/config-bundles/apply'].post;
    const runs = openApi.paths['/api/authz/config-bundles/runs'].get;
    const run = openApi.paths['/api/authz/config-bundles/runs/{id}'].get;
    const exportBundle = openApi.paths['/api/authz/config-bundles/export'].get;
    const document = JSON.stringify(openApi);

    expect(preview.requestBody).toBeDefined();
    expect(preview.responses['200'].content['application/json'].schema).toBeDefined();
    expect(diff.responses['200'].content['application/json'].schema).toBeDefined();
    expect(apply.requestBody.content['application/json'].schema).toBeDefined();
    expect(apply.responses['200'].content['application/json'].schema).toBeDefined();
    expect(runs.responses['200'].content['application/json'].schema).toBeDefined();
    expect(run.responses['200'].content['application/json'].schema).toBeDefined();
    expect(exportBundle.responses['200'].content['application/json'].schema).toBeDefined();
    expect(document).toContain('expectedPreviewHash');
    expect(document).toContain('expandedRolePermissions');
    expect(document).toContain('canonicalHash');
    expect(document).toContain('runtime_resource_set');
  });

  it('detects a missing public action route in strict OpenAPI mode while ignoring scanner-only aliases', () => {
    const openApi = generateOpenApi();
    delete openApi.paths['/api/admin/settings'];

    const result = validateAuthzRouteInventory(openApi, { requireOpenApiForActionRoutes: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'action.route.missing-openapi',
        actionId: 'platform.settings.read',
        method: 'GET',
        route: '/api/admin/settings',
      }),
      expect.objectContaining({
        code: 'action.route.missing-openapi',
        actionId: 'platform.settings.manage',
        method: 'PUT',
        route: '/api/admin/settings',
      }),
    ]));
    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'action.route.missing-openapi',
        route: '/',
      }),
    ]));
  });

  it('registers role-assignment mutations as high-risk audited Access Control actions', () => {
    const createAction = getAuthzActionDefinition('platform.authz.assignments.create');
    const deleteAction = getAuthzActionDefinition('platform.authz.assignments.delete');

    expect(createAction).toMatchObject({
      permissionId: 'platform:authz:roles:manage',
      resourceType: 'platform',
      risk: 'high',
      audit: true,
      category: 'Access Control',
    });
    expect(createAction?.routes).toEqual([
      expect.objectContaining({
        method: 'POST',
        route: '/api/authz/role-assignments',
        resourceResolver: 'platform.self',
      }),
    ]);

    expect(deleteAction).toMatchObject({
      permissionId: 'platform:authz:roles:manage',
      resourceType: 'platform',
      risk: 'high',
      audit: true,
      category: 'Access Control',
    });
    expect(deleteAction?.routes).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        route: '/api/authz/role-assignments/:id',
        resourceResolver: 'platform.self',
      }),
    ]);
  });

  it('registers Access Control catalog, group, and policy mutations as high-risk audited actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.authz.roles.manage',
        routes: [
          ['POST', '/api/authz/permissions'],
          ['POST', '/api/authz/roles'],
          ['PUT', '/api/authz/roles/{id}'],
          ['DELETE', '/api/authz/roles/{id}'],
          ['POST', '/api/authz/config-bundles/preview'],
          ['POST', '/api/authz/config-bundles/diff'],
          ['POST', '/api/authz/config-bundles/apply'],
          ['GET', '/api/authz/config-bundles/runs'],
          ['GET', '/api/authz/config-bundles/runs/{id}'],
          ['GET', '/api/authz/config-bundles/export'],
        ],
      },
      {
        actionId: 'platform.authz.groups.manage',
        routes: [
          ['POST', '/api/authz/groups'],
          ['PUT', '/api/authz/groups/:id'],
          ['DELETE', '/api/authz/groups/:id'],
          ['POST', '/api/authz/group-memberships'],
          ['DELETE', '/api/authz/group-memberships/:id'],
        ],
      },
      {
        actionId: 'platform.authz.policies.manage',
        routes: [
          ['POST', '/api/authz/policies'],
          ['PUT', '/api/authz/policies/{id}'],
          ['DELETE', '/api/authz/policies/{id}'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);
      expect(action).toMatchObject({
        permissionId: 'platform:authz:roles:manage',
        resourceType: 'platform',
        risk: 'high',
        audit: true,
        category: 'Access Control',
      });
      expect(action?.routes).toEqual(expected.routes.map(([method, route]) => expect.objectContaining({
        method,
        route,
        resourceResolver: 'platform.self',
      })));
    }
  });

  it('registers unredacted audit reads as a critical audited additional check', () => {
    const readAction = getAuthzActionDefinition('platform.audit.read');
    const unredactedAction = getAuthzActionDefinition('platform.audit.unredacted.read');

    expect(unredactedAction).toMatchObject({
      permissionId: 'platform:audit:unredacted-view',
      resourceType: 'platform',
      operation: 'reveal',
      risk: 'critical',
      audit: true,
      category: 'Audit',
    });
    expect(readAction?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        route: '/api/audit/logs',
        additionalChecks: expect.arrayContaining(['platform.audit.unredacted.read when unredacted audit payloads are requested']),
      }),
      expect.objectContaining({
        method: 'GET',
        route: '/api/audit/logs/user/{userId}',
        additionalChecks: expect.arrayContaining(['platform.audit.unredacted.read when unredacted audit payloads are requested']),
      }),
      expect.objectContaining({
        method: 'GET',
        route: '/api/audit/logs/resource/{resourceType}/{resourceId}',
        additionalChecks: expect.arrayContaining(['platform.audit.unredacted.read when unredacted audit payloads are requested']),
      }),
    ]));
  });

  it('registers deployment delete routes as high-risk audited engine actions', () => {
    const deleteAction = getAuthzActionDefinition('engine.deployments.delete');

    expect(deleteAction).toMatchObject({
      permissionId: 'engine:deploy',
      resourceType: 'engine',
      operation: 'delete',
      risk: 'high',
      audit: true,
      category: 'Deployments',
    });
    expect(deleteAction?.routes).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        route: '/starbase-api/deployments/{id}',
        resourceResolver: 'engine.byId',
      }),
      expect.objectContaining({
        method: 'DELETE',
        route: '/engines-api/engines/{engineId}/deployments/{id}',
        resourceResolver: 'engine.byId',
      }),
    ]);
  });

  it('registers engine governance mutations as high-risk audited engine actions', () => {
    const expectedActions = [
      {
        actionId: 'engine.delegate.manage',
        permissionId: 'engine:delegate:manage',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'engine.delegate.manage',
        route: '/engines-api/engines/{engineId}/delegate',
      },
      {
        actionId: 'engine.ownership.transfer',
        permissionId: 'engine:ownership:transfer',
        operation: 'manage',
        risk: 'critical',
        surfaceId: 'engine.ownership.transfer',
        route: '/engines-api/engines/{engineId}/transfer-ownership',
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: 'engine',
        operation: expected.operation,
        risk: expected.risk,
        audit: true,
        category: 'Engine Governance',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual([
        expect.objectContaining({
          method: 'POST',
          route: expected.route,
          resourceResolver: 'engine.byId',
        }),
      ]);
    }
  });

  it('registers engine inventory create and decommission as high-risk audited actions', () => {
    const createAction = getAuthzActionDefinition('engine.inventory.create');
    const decommissionAction = getAuthzActionDefinition('engine.external-registration.decommission');

    expect(createAction).toMatchObject({
      permissionId: 'platform:engine:create',
      resourceType: 'platform',
      operation: 'create',
      risk: 'high',
      audit: true,
      category: 'Engine Inventory',
    });
    expect(createAction?.routes).toEqual([
      expect.objectContaining({
        method: 'POST',
        route: '/engines-api/engines',
        resourceResolver: 'platform.self',
        additionalChecks: expect.arrayContaining([
          'current handler accepts authenticated users and assigns the caller as owner',
          'future strict enforcement should use platform:engine:create; default user/developer roles include it for compatibility',
          'externalId and label changes refresh Engine Set materializations',
        ]),
      }),
    ]);

    expect(decommissionAction).toMatchObject({
      permissionId: 'platform:engine-registration:manage',
      resourceType: 'platform',
      operation: 'sync',
      risk: 'critical',
      audit: true,
      category: 'Engine Inventory',
    });
    expect(decommissionAction?.routes).toEqual([
      expect.objectContaining({
        method: 'POST',
        route: '/engines-api/external/engines/decommission',
        resourceResolver: 'platform.self',
        additionalChecks: expect.arrayContaining([
          'API client bearer token with engine:register scope is required',
          'API client must have either platform:engine-registration:manage at platform scope or external-engine-system:engine-registration:manage for the provided externalSystemId',
          'only externally registered engines can be decommissioned through this API',
          'decommission keeps engine inventory and audit records but removes Engine Set materializations for the engine',
        ]),
      }),
    ]);
  });

  it('registers high-risk Git mutations as audited actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.git.providers.manage',
        permissionId: 'platform:git-provider:manage',
        resourceType: 'platform',
        operation: 'manage',
        surfaceId: 'admin.git-providers',
        routes: [
          ['GET', '/git-api/admin/providers', 'platform.self'],
          ['PUT', '/git-api/admin/providers/:id', 'platform.self'],
        ],
      },
      {
        actionId: 'project.create.git.create',
        permissionId: 'project:create',
        resourceType: 'platform',
        operation: 'create',
        surfaceId: 'project.create.git.submit',
        routes: [
          ['POST', '/git-api/clone', 'platform.self'],
          ['POST', '/git-api/create-online', 'platform.self'],
        ],
      },
      {
        actionId: 'project.git.repositories.manage',
        permissionId: 'project:git:connect',
        resourceType: 'project',
        operation: 'manage',
        surfaceId: 'project.git.connection.manage',
        routes: [
          ['POST', '/git-api/repositories/init', 'project.byId'],
          ['POST', '/git-api/repositories/clone', 'project.byId'],
          ['DELETE', '/git-api/repositories/:id', 'project.byGitRepositoryId'],
          ['POST', '/git-api/project-connection', 'project.byId'],
          ['PUT', '/git-api/project-connection/token', 'project.byId'],
          ['DELETE', '/git-api/project-connection', 'project.byId'],
        ],
      },
      {
        actionId: 'project.git.rollback',
        permissionId: 'project:versions:restore',
        resourceType: 'project',
        operation: 'execute',
        surfaceId: 'project.git.rollback',
        routes: [
          ['POST', '/git-api/rollback', 'project.byId'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: expected.operation,
        risk: 'high',
        audit: true,
        category: 'Git',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      })));
    }
  });

  it('registers high-risk SSO management actions as audited mapping and provider actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.sso.engine-assignments.manage',
        permissionId: 'platform:sso-assignments:manage',
        resourceType: 'sso_mapping',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'admin.access-control.sso-engine-assignments.edit',
        routes: [
          ['POST', '/api/authz/sso-assignment-mappings', 'platform.self'],
          ['PUT', '/api/authz/sso-assignment-mappings/:id', 'ssoMapping.byId'],
	          ['DELETE', '/api/authz/sso-assignment-mappings/:id', 'ssoMapping.byId'],
	          ['POST', '/api/authz/sso-assignment-mappings/test', 'platform.self'],
	          ['POST', '/api/authz/sso-sync-runs/reconcile', 'platform.self'],
	          ['POST', '/api/engines/:engineId/access/transition-cleanup-preview', 'platform.self'],
	          ['POST', '/api/engines/:engineId/access/transition-cleanup', 'platform.self'],
	        ],
	      },
      {
        actionId: 'platform.sso.group-mappings.manage',
        permissionId: 'platform:sso-assignments:manage',
        resourceType: 'sso_mapping',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'admin.access-control.sso-group-mappings.edit',
        routes: [
          ['POST', '/api/authz/sso-group-mappings', 'platform.self'],
          ['PUT', '/api/authz/sso-group-mappings/:id', 'ssoMapping.byId'],
          ['DELETE', '/api/authz/sso-group-mappings/:id', 'ssoMapping.byId'],
          ['POST', '/api/authz/sso-group-mappings/test', 'platform.self'],
          ['POST', '/api/identity/mappings', 'platform.self'],
          ['PUT', '/api/identity/mappings/{id}', 'platform.self'],
          ['DELETE', '/api/identity/mappings/{id}', 'platform.self'],
          ['POST', '/api/identity/mappings/test', 'platform.self'],
        ],
      },
      {
        actionId: 'platform.sso.platform-role-mappings.manage',
        permissionId: 'platform:sso-platform-role-mappings:manage',
        resourceType: 'sso_mapping',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'admin.sso.role-mappings.edit',
        routes: [
          ['POST', '/api/authz/sso-mappings', 'platform.self'],
          ['PUT', '/api/authz/sso-mappings/{id}', 'ssoMapping.byId'],
          ['DELETE', '/api/authz/sso-mappings/{id}', 'ssoMapping.byId'],
          ['POST', '/api/authz/sso-mappings/test', 'platform.self'],
        ],
      },
      {
        actionId: 'platform.sso.providers.manage',
        permissionId: 'platform:sso-providers:manage',
        resourceType: 'platform',
        operation: 'manage',
        risk: 'critical',
        surfaceId: 'admin.sso.providers.actions',
        routes: [
          ['POST', '/api/sso/providers', 'platform.self'],
          ['POST', '/api/identity/providers', 'platform.self'],
          ['PUT', '/api/identity/providers/{key}', 'platform.self'],
          ['DELETE', '/api/identity/providers/{key}', 'platform.self'],
          ['POST', '/api/identity/providers/{key}/reconcile', 'platform.self'],
          ['POST', '/api/identity/providers/{key}/reconciliation-preview', 'platform.self'],
          ['POST', '/api/identity/providers/{key}/replay-memberships', 'platform.self'],
          ['POST', '/api/identity/providers/{key}/test-connection', 'platform.self'],
          ['PUT', '/api/sso/providers/{id}', 'platform.self'],
          ['DELETE', '/api/sso/providers/{id}', 'platform.self'],
          ['POST', '/api/sso/providers/{id}/toggle', 'platform.self'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: expected.operation,
        risk: expected.risk,
        audit: true,
        category: 'SSO',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      })));
    }
  });

  it('registers high-risk Project Engine Target management actions as audited actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.project-engine-targets.manage',
        permissionId: 'platform:project-engine-targets:manage',
        resourceType: 'project_engine_target',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'admin.access-control.project-engine-targets.edit',
        routes: [
          ['POST', '/api/authz/project-engine-targets', 'platform.self'],
          ['PUT', '/api/authz/project-engine-targets/:id', 'projectEngineTarget.byId'],
          ['DELETE', '/api/authz/project-engine-targets/:id', 'projectEngineTarget.byId'],
          ['POST', '/api/authz/project-engine-targets/sync-legacy', 'platform.self'],
        ],
      },
      {
        actionId: 'engine.project-access.revoke',
        permissionId: 'engine:project-access:revoke',
        resourceType: 'engine',
        operation: 'delete',
        risk: 'high',
        surfaceId: 'engine.project-access.revoke',
        routes: [
          ['DELETE', '/engines-api/engines/{engineId}/projects/{projectId}', 'engine.byId'],
        ],
      },
      {
        actionId: 'project-engine-target.external-registration.upsert',
        permissionId: 'external-engine-system:project-targets:manage',
        resourceType: 'external_engine_system',
        operation: 'sync',
        risk: 'critical',
        surfaceId: 'admin.project-engine-targets.external-api',
        routes: [
          ['POST', '/engines-api/external/project-engine-targets', 'externalEngineSystem.byId'],
        ],
      },
      {
        actionId: 'project-engine-target.external-registration.decommission',
        permissionId: 'external-engine-system:project-targets:manage',
        resourceType: 'external_engine_system',
        operation: 'sync',
        risk: 'critical',
        surfaceId: 'admin.project-engine-targets.external-api.decommission',
        routes: [
          ['POST', '/engines-api/external/project-engine-targets/decommission', 'externalEngineSystem.byId'],
        ],
      },
      {
        actionId: 'project.deployment-targets.manage',
        permissionId: 'project:deployment-targets:manage',
        resourceType: 'project',
        operation: 'manage',
        risk: 'high',
        surfaceId: 'project.settings.deployment-targets.edit',
        routes: [
          ['POST', '/starbase-api/projects/{projectId}/deployment-targets', 'project.byId'],
          ['PUT', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', 'project.byId'],
          ['DELETE', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', 'project.byId'],
          ['POST', '/starbase-api/projects/{projectId}/deployment-targets/sync-legacy', 'project.byId'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: expected.operation,
        risk: expected.risk,
        audit: true,
        category: 'Project Engine Targets',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      })));
    }
  });

  it('registers platform machine identity and Engine Set management actions as audited actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.api-clients.manage',
        permissionId: 'platform:api-clients:manage',
        resourceType: 'api_client',
        category: 'API Clients',
        risk: 'critical',
        surfaceId: 'admin.access-control.api-clients',
        routes: [
          ['POST', '/api/authz/api-clients', 'platform.self'],
          ['POST', '/api/authz/api-clients/{id}/rotate', 'apiClient.byId'],
          ['DELETE', '/api/authz/api-clients/{id}', 'apiClient.byId'],
        ],
      },
      {
        actionId: 'platform.service-accounts.manage',
        permissionId: 'platform:service-accounts:manage',
        resourceType: 'platform',
        category: 'Service Accounts',
        risk: 'critical',
        surfaceId: 'admin.access-control.service-accounts',
        routes: [
          ['POST', '/api/authz/service-accounts', 'platform.self'],
          ['POST', '/api/authz/service-accounts/{id}/rotate', 'platform.self'],
          ['DELETE', '/api/authz/service-accounts/{id}', 'platform.self'],
        ],
      },
      {
        actionId: 'platform.engine-sets.manage',
        permissionId: 'platform:engine-sets:manage',
        resourceType: 'engine_set',
        category: 'Engine Sets',
        risk: 'high',
        surfaceId: 'admin.access-control.engine-sets.edit',
        routes: [
          ['POST', '/api/authz/engine-sets', 'platform.self'],
          ['PUT', '/api/authz/engine-sets/:id', 'engineSet.byId'],
          ['DELETE', '/api/authz/engine-sets/:id', 'engineSet.byId'],
          ['POST', '/api/authz/engine-sets/preview', 'platform.self'],
          ['POST', '/api/authz/engine-sets/:id/materialize', 'engineSet.byId'],
          ['POST', '/api/authz/runtime-resource-sets/:id/materialize', 'platform.self'],
          ['POST', '/api/authz/runtime-resources/:id/reconcile', 'engine.byId'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: 'manage',
        risk: expected.risk,
        audit: true,
        category: expected.category,
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      })));
    }
  });

  it('registers external engine registration and governance management as audited actions', () => {
    const expectedActions = [
      {
        actionId: 'platform.external-engine-systems.manage',
        permissionId: 'platform:engine-registration:manage',
        resourceType: 'platform',
        operation: 'manage',
        risk: 'critical',
        category: 'External Engine Registration',
        surfaceId: 'admin.access-control.external-engine-systems.actions',
        routes: [
          ['POST', '/api/authz/external-engine-systems', 'platform.self'],
          ['PUT', '/api/authz/external-engine-systems/{id}', 'platform.self'],
          ['DELETE', '/api/authz/external-engine-systems/{id}', 'platform.self'],
        ],
      },
      {
        actionId: 'platform.external-engines.reconcile',
        permissionId: 'platform:engine-registration:manage',
        resourceType: 'engine',
        operation: 'sync',
        risk: 'high',
        category: 'External Engine Registration',
        surfaceId: 'admin.access-control.external-engines.reconcile',
        routes: [
          ['POST', '/api/authz/external-engines/{id}/reconcile', 'engine.byId'],
        ],
      },
      {
        actionId: 'platform.external-engines.lifecycle.manage',
        permissionId: 'platform:engine-registration:manage',
        resourceType: 'engine',
        operation: 'manage',
        risk: 'critical',
        category: 'External Engine Registration',
        surfaceId: 'admin.access-control.external-engines.lifecycle-actions',
        routes: [
          ['POST', '/api/authz/external-engines/{id}/decommission', 'engine.byId'],
          ['POST', '/api/authz/external-engines/{id}/reactivate', 'engine.byId'],
        ],
      },
      {
        actionId: 'platform.governance.manage',
        permissionId: 'platform:settings:manage',
        resourceType: 'platform',
        operation: 'manage',
        risk: 'high',
        category: 'Governance',
        surfaceId: 'admin.governance.actions',
        routes: [
          ['POST', '/api/admin/projects/{projectId}/assign-owner', 'platform.self'],
          ['POST', '/api/admin/projects/{projectId}/assign-delegate', 'platform.self'],
          ['POST', '/api/admin/engines/{engineId}/assign-owner', 'platform.self'],
          ['POST', '/api/admin/engines/{engineId}/assign-delegate', 'platform.self'],
        ],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: expected.operation,
        risk: expected.risk,
        audit: true,
        category: expected.category,
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(expect.arrayContaining(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      }))));
    }
  });

  it('registers high-risk Starbase project, file, member, and version actions as audited actions', () => {
    const expectedActions = [
      {
        actionId: 'project.projects.create',
        permissionId: 'project:create',
        resourceType: 'platform',
        operation: 'create',
        risk: 'high',
        category: 'Projects',
        surfaceId: 'starbase.projects.create',
        routes: [['POST', '/starbase-api/projects', 'platform.self']],
      },
      {
        actionId: 'project.projects.delete',
        permissionId: 'project:delete',
        resourceType: 'project',
        operation: 'delete',
        risk: 'critical',
        category: 'Projects',
        surfaceId: 'project.settings.delete',
        routes: [['DELETE', '/starbase-api/projects/{projectId}', 'project.byId']],
      },
      {
        actionId: 'project.files.update',
        permissionId: 'project:files:edit',
        resourceType: 'project',
        operation: 'update',
        risk: 'high',
        category: 'Project Files',
        surfaceId: 'project.files.edit',
        routes: [
          ['PUT', '/starbase-api/files/{fileId}', 'project.byFileId'],
          ['PATCH', '/starbase-api/files/{fileId}', 'project.byFileId'],
          ['PATCH', '/starbase-api/folders/{folderId}', 'project.byFolderId'],
        ],
      },
      {
        actionId: 'project.files.restore',
        permissionId: 'project:versions:restore',
        resourceType: 'project',
        operation: 'execute',
        risk: 'high',
        category: 'Project Files',
        surfaceId: 'project.files.restore',
        routes: [['POST', '/starbase-api/files/{fileId}/restore-from-commit', 'project.byFileId']],
      },
      {
        actionId: 'project.versions.restore',
        permissionId: 'project:versions:restore',
        resourceType: 'project',
        operation: 'execute',
        risk: 'high',
        category: 'Project Versions',
        surfaceId: 'project.versions.restore',
        routes: [['POST', '/starbase-api/files/{fileId}/versions/{versionId}/restore', 'project.byFileId']],
      },
      {
        actionId: 'project.vcs.publish',
        permissionId: 'project:versions:create',
        resourceType: 'project',
        operation: 'execute',
        risk: 'high',
        category: 'Project Versions',
        surfaceId: 'project.vcs.publish',
        routes: [['POST', '/vcs-api/projects/{projectId}/publish', 'project.byId']],
      },
      {
        actionId: 'project.vcs.commit.restore',
        permissionId: 'project:versions:restore',
        resourceType: 'project',
        operation: 'execute',
        risk: 'high',
        category: 'Project Versions',
        surfaceId: 'project.vcs.commit.restore',
        routes: [['POST', '/vcs-api/projects/{projectId}/commits/{commitId}/restore', 'project.byId']],
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: expected.resourceType,
        operation: expected.operation,
        risk: expected.risk,
        audit: true,
        category: expected.category,
      });
      expect(action?.ui).toEqual(expect.arrayContaining([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]));
      expect(action?.routes).toEqual(expected.routes.map(([method, route, resourceResolver]) => expect.objectContaining({
        method,
        route,
        resourceResolver,
      })));
    }
  });

  it('registers high-risk project member actions as audited project actions', () => {
    const expectedActions = [
      ['project.members.invite', 'project:members:invite', 'create', 'high', 'project.members.invite', [
        ['GET', '/starbase-api/projects/{projectId}/members/capabilities'],
        ['POST', '/starbase-api/projects/{projectId}/pending-invites/{invitationId}/reissue'],
      ]],
      ['project.members.add', 'project:members:add', 'create', 'high', 'project.members.add', [
        ['POST', '/starbase-api/projects/{projectId}/members'],
      ]],
      ['project.members.update-role', 'project:members:update-role', 'update', 'high', 'project.members.role', [
        ['PATCH', '/starbase-api/projects/{projectId}/members/{userId}'],
      ]],
      ['project.members.remove', 'project:members:remove', 'delete', 'high', 'project.members.remove', [
        ['DELETE', '/starbase-api/projects/{projectId}/members/{userId}'],
      ]],
      ['project.members.deploy-grant.manage', 'project:members:manage-deploy-grant', 'manage', 'high', 'project.members.deploy-grant', [
        ['PUT', '/starbase-api/projects/{projectId}/members/{userId}/deploy-permission'],
      ]],
      ['project.ownership.transfer', 'project:ownership:transfer', 'manage', 'critical', 'project.members.transfer-ownership', [
        ['POST', '/starbase-api/projects/{projectId}/transfer-ownership'],
      ]],
    ] as const;

    for (const [actionId, permissionId, operation, risk, surfaceId, routes] of expectedActions) {
      const action = getAuthzActionDefinition(actionId);

      expect(action).toMatchObject({
        permissionId,
        resourceType: 'project',
        operation,
        risk,
        audit: true,
        category: 'Project Members',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual(routes.map(([method, route]) => expect.objectContaining({
        method,
        route,
        resourceResolver: 'project.byId',
      })));
    }
  });

  it('registers high-risk user management actions as audited platform actions', () => {
    const expectedActions = [
      ['platform.users.create', 'platform:users:create', 'create', 'high', 'admin.users.create', [['POST', '/api/users']]],
      ['platform.users.update', 'platform:users:update', 'update', 'high', 'admin.users.edit', [['PUT', '/api/users/{id}']]],
      ['platform.users.deactivate', 'platform:users:deactivate', 'delete', 'high', 'admin.users.deactivate', [['DELETE', '/api/users/{id}']]],
      ['platform.users.permanent-delete', 'platform:users:permanent-delete', 'delete', 'critical', 'admin.users.permanent-delete', [['DELETE', '/api/users/{id}/permanent']]],
      ['platform.users.unlock', 'platform:users:unlock', 'execute', 'high', 'admin.users.unlock', [['POST', '/api/users/{id}/unlock']]],
      ['platform.users.manage', 'platform:users:update', 'manage', 'high', 'admin.users.actions', []],
    ] as const;

    for (const [actionId, permissionId, operation, risk, surfaceId, routes] of expectedActions) {
      const action = getAuthzActionDefinition(actionId);

      expect(action).toMatchObject({
        permissionId,
        resourceType: 'platform',
        operation,
        risk,
        audit: true,
        category: 'Users',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId,
          behavior: 'disable',
        }),
      ]);
      if (routes.length > 0) {
        expect(action?.routes).toEqual(routes.map(([method, route]) => expect.objectContaining({
          method,
          route,
          resourceResolver: 'platform.self',
        })));
      } else {
        expect(action?.routes || []).toEqual([]);
      }
    }
  });

  it('registers high-risk Mission Control runtime actions as audited engine actions', () => {
    const expectedActionIds = [
      'engine.variables.update',
      'engine.instances.mutate',
      'engine.runtime.batches.process-instances.delete',
      'engine.runtime.batches.process-instances.suspend',
      'engine.runtime.batches.process-instances.activate',
      'engine.runtime.batches.jobs.retry',
      'engine.runtime.batches.suspension.update',
      'engine.runtime.batches.cancel',
      'engine.runtime.batches.record.delete',
      'engine.runtime.decisions.evaluate',
      'engine.runtime.migrations.execute-async',
      'engine.runtime.migrations.execute-direct',
      'engine.runtime.process-instances.suspension.update',
      'engine.runtime.process-instances.retry',
      'engine.runtime.process-instances.modify',
      'engine.runtime.process-instances.delete',
      'engine.runtime.process-instances.variables.update',
      'engine.runtime.process-definitions.start',
      'engine.runtime.process-definitions.modification.execute-async',
      'engine.runtime.process-definitions.restart.execute-async',
      'engine.runtime.direct.process-instances.delete',
      'engine.runtime.direct.process-instances.suspend',
      'engine.runtime.direct.process-instances.activate',
      'engine.runtime.direct.jobs.retry',
      'engine.runtime.tasks.variables.update',
      'engine.runtime.tasks.assignment.update',
      'engine.runtime.tasks.complete',
      'engine.runtime.external-tasks.fetch-and-lock',
      'engine.runtime.external-tasks.complete',
      'engine.runtime.external-tasks.failure',
      'engine.runtime.external-tasks.bpmn-error',
      'engine.runtime.external-tasks.extend-lock',
      'engine.runtime.external-tasks.unlock',
      'engine.runtime.messages.correlate',
      'engine.runtime.signals.deliver',
      'engine.runtime.jobs.execute',
      'engine.runtime.jobs.retries.update',
      'engine.runtime.jobs.suspension.update',
      'engine.runtime.job-definitions.retries.update',
      'engine.runtime.job-definitions.suspension.update',
    ];

    for (const actionId of expectedActionIds) {
      const action = getAuthzActionDefinition(actionId);

      expect(action).toMatchObject({
        resourceType: 'engine',
        audit: true,
      });
      expect(action?.category).toMatch(/^Mission Control/);
      expect(['high', 'critical']).toContain(action?.risk);
      expect(action?.ui).toEqual(expect.arrayContaining([
        expect.objectContaining({ behavior: 'disable' }),
      ]));
      for (const route of action?.routes || []) {
        expect(route).toEqual(expect.objectContaining({
          resourceResolver: 'engine.byId',
        }));
      }
    }
  });

  it('registers engine environment mutations as high-risk audited engine actions', () => {
    const expectedActions = [
      {
        actionId: 'engine.environment.set',
        permissionId: 'engine:environment:set',
        surfaceId: 'engine.environment.tag',
        route: '/engines-api/engines/{engineId}/environment',
      },
      {
        actionId: 'engine.environment.lock',
        permissionId: 'engine:environment:lock',
        surfaceId: 'engine.environment.lock',
        route: '/engines-api/engines/{engineId}/lock',
      },
    ];

    for (const expected of expectedActions) {
      const action = getAuthzActionDefinition(expected.actionId);

      expect(action).toMatchObject({
        permissionId: expected.permissionId,
        resourceType: 'engine',
        operation: 'manage',
        risk: 'high',
        audit: true,
        category: 'Engine Environment',
      });
      expect(action?.ui).toEqual([
        expect.objectContaining({
          surfaceId: expected.surfaceId,
          behavior: 'disable',
        }),
      ]);
      expect(action?.routes).toEqual([
        expect.objectContaining({
          method: 'POST',
          route: expected.route,
          resourceResolver: 'engine.byId',
          additionalChecks: expect.arrayContaining([
            'engine:edit or legacy engine manage role also accepted for compatibility',
          ]),
        }),
      ]);
    }
  });

  it('detects OpenAPI authz metadata drift for a registered protected route', () => {
    const openApi = generateOpenApi();
    const operation = openApi.paths['/engines-api/engines/{engineId}/deployments'].post;
    operation[AUTHZ_OPENAPI_EXTENSION_KEY] = {
      ...operation[AUTHZ_OPENAPI_EXTENSION_KEY],
      permission: 'engine:deploy:view',
    };

    const result = validateAuthzRouteInventory(openApi);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'openapi.extension-mismatch',
        actionId: 'project-engine-target.deploy.use',
        field: 'permission',
        expected: 'project:deploy',
        actual: 'engine:deploy:view',
      }),
    ]));
  });

  it('detects OpenAPI authz metadata for a route missing from the action inventory', () => {
    const openApi = generateOpenApi();
    openApi.paths['/unregistered/protected-route'] = {
      get: {
        responses: { 200: { description: 'ok' } },
        [AUTHZ_OPENAPI_EXTENSION_KEY]: {
          actionId: 'engine.deployments.read',
          permission: 'engine:deploy:view',
          resourceResolver: 'engine.byId',
          risk: 'medium',
          audit: false,
          uiBehavior: 'hide',
        },
      },
    };

    const result = validateAuthzRouteInventory(openApi);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'openapi.route-not-registered',
        actionId: 'engine.deployments.read',
        method: 'GET',
        openApiPath: '/unregistered/protected-route',
      }),
    ]));
  });

  it('detects OpenAPI authz exemption metadata drift for a registered exemption route', () => {
    const openApi = generateOpenApi();
    const operation = openApi.paths['/api/auth/me'].get;
    operation[AUTHZ_OPENAPI_EXEMPTION_KEY] = {
      ...operation[AUTHZ_OPENAPI_EXEMPTION_KEY],
      reason: 'wrong reason',
    };

    const result = validateAuthzRouteInventory(openApi);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'openapi.exemption-mismatch',
        method: 'GET',
        openApiPath: '/api/auth/me',
        field: 'reason',
        actual: 'wrong reason',
      }),
    ]));
  });

  it('detects OpenAPI authz exemption metadata for a route missing from the exemption inventory', () => {
    const openApi = generateOpenApi();
    openApi.paths['/api/auth/unknown-self-service'] = {
      post: {
        responses: { 200: { description: 'ok' } },
        [AUTHZ_OPENAPI_EXEMPTION_KEY]: {
          kind: 'auth-only',
          reason: 'Authenticated users may perform this self-service operation.',
          risk: 'low',
          owner: 'platform-auth',
        },
      },
    };

    const result = validateAuthzRouteInventory(openApi);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'openapi.unknown-exemption',
        method: 'POST',
        openApiPath: '/api/auth/unknown-self-service',
      }),
    ]));
  });
});
