import { randomUUID } from 'node:crypto';

import {
  opaqueReferenceSchema,
  pluginDisableRequestV1Schema,
  pluginEnableRequestV1Schema,
  pluginEventDeadLetterListV1Schema,
  pluginEventDeadLetterRequeueRequestV1Schema,
  pluginEventDeadLetterRequeueResultV1Schema,
  pluginIdSchema,
  pluginPlatformEmergencyRequestV1Schema,
  pluginTenantApplicationDecisionRequestV1Schema,
  pluginTenantApplicationMutationRequestV1Schema,
  pluginTenantEligibilityApplyRequestV1Schema,
  pluginTenantEnablementRequestV1Schema,
  type PluginSafeReasonCodeV1,
  type PluginPlatformCapabilityCatalogV1,
} from '@enterpriseglue/plugin-sdk';
import { requireServiceAccountScope } from '@enterpriseglue/shared/middleware/apiClientAuth.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { ServiceAccountScopes } from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

import {
  PluginControlErrorV1,
  type PluginControlPlaneV1,
} from './pluginControlPlane.js';
import {
  DatabasePluginEventDeliveryStoreV1,
  type PluginEventOperationsStoreV1,
} from './pluginEventDeliveryStore.js';
import type { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';
import type { PluginEventMetricsRegistryV1 } from './pluginEventMetrics.js';
import { PluginTenantEligibilityVerificationErrorV1 } from './pluginTenantEligibility.js';

export interface PluginControlRouteOptionsV1 {
  /** Optional test or deployment override for every deployment read endpoint. */
  deploymentReadMiddleware?: RequestHandler[];
  /** Optional test or deployment override for every deployment mutation endpoint. */
  deploymentManageMiddleware?: RequestHandler[];
  /** Optional test or deployment override for every tenant-scoped read endpoint. */
  tenantReadMiddleware?: RequestHandler[];
  /** Optional test or deployment override for every tenant-scoped mutation endpoint. */
  tenantManageMiddleware?: RequestHandler[];
  /** Optional test override for tenant activation-request endpoints. */
  tenantRequestMiddleware?: RequestHandler[];
  /** Optional test or host-composition override for workload eligibility ingestion. */
  eligibilityWorkloadMiddleware?: RequestHandler[];
  /** @deprecated Use deploymentReadMiddleware or deploymentManageMiddleware. */
  deploymentAdminMiddleware?: RequestHandler[];
  /** @deprecated Use tenantReadMiddleware or tenantManageMiddleware. */
  tenantAdminMiddleware?: RequestHandler[];
  eventOperations?: PluginEventOperationsStoreV1;
  diagnosticMetrics?: Pick<
    PluginDiagnosticMetricsRegistryV1,
    'snapshot'
  >;
  eventMetrics?: Pick<PluginEventMetricsRegistryV1, 'snapshot'>;
  capabilityCatalog?: PluginPlatformCapabilityCatalogV1;
}

export function registerPluginControlRoutesV1(
  app: Express,
  control: PluginControlPlaneV1,
  options: PluginControlRouteOptionsV1 = {},
): void {
  const deploymentRead =
    options.deploymentReadMiddleware ??
    options.deploymentAdminMiddleware ??
    [apiLimiter, requireAuth, requireAction('platform.settings.read')];
  const deploymentManage =
    options.deploymentManageMiddleware ??
    options.deploymentAdminMiddleware ??
    [apiLimiter, requireAuth, requireAction('platform.settings.manage')];
  const tenantRead =
    options.tenantReadMiddleware ??
    options.tenantAdminMiddleware ?? [
      apiLimiter,
      requireAuth,
      resolveTenantContext({ required: true }),
      requireAction('tenant.apps.read'),
    ];
  const tenantManage =
    options.tenantManageMiddleware ??
    options.tenantAdminMiddleware ?? [
      apiLimiter,
      requireAuth,
      resolveTenantContext({ required: true }),
      requireAction('tenant.apps.manage'),
    ];
  const tenantRequest =
    options.tenantRequestMiddleware ??
    options.tenantAdminMiddleware ?? [
      apiLimiter,
      requireAuth,
      resolveTenantContext({ required: true }),
      requireAction('tenant.apps.request'),
    ];
  const eligibilityWorkload = options.eligibilityWorkloadMiddleware ?? [
    apiLimiter,
    requireServiceAccountScope(ServiceAccountScopes.TENANT_LIFECYCLE),
  ];
  const eventOperations =
    options.eventOperations ?? new DatabasePluginEventDeliveryStoreV1();

  if (options.capabilityCatalog) {
    app.get(
      '/api/plugin-platform/v1/capabilities',
      ...deploymentRead,
      route(async (_request, response) => {
        noStore(response);
        response.json(options.capabilityCatalog);
      }),
    );
  }
  app.get(
    '/api/plugin-platform/v1/plugins',
    ...deploymentRead,
    route(async (_request, response) => {
      noStore(response);
      response.json(await control.list());
    }),
  );
  app.get(
    '/api/plugin-platform/v1/emergency-control',
    ...deploymentRead,
    route(async (_request, response) => {
      noStore(response);
      response.json(await control.getEmergencyState());
    }),
  );
  app.get(
    '/api/plugin-platform/v1/deployment-execution',
    ...deploymentRead,
    route(async (_request, response) => {
      noStore(response);
      response.json(await control.getDeploymentExecution());
    }),
  );
  app.put(
    '/api/plugin-platform/v1/emergency-control',
    ...deploymentManage,
    route(async (request, response) => {
      const input = pluginPlatformEmergencyRequestV1Schema.parse(
        request.body,
      );
      noStore(response);
      response.json(
        await control.setEmergencyDisabled({
          disabled: input.disabled,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          actorRef: actorRef(request),
          correlationId: correlationId(request),
        }),
      );
    }),
  );
  app.get(
    '/api/plugin-platform/v1/audit',
    ...deploymentRead,
    route(async (_request, response) => {
      noStore(response);
      response.json(await control.listAudit());
    }),
  );
  if (options.diagnosticMetrics) {
    app.get(
      '/api/plugin-platform/v1/metrics/diagnostics',
      ...deploymentRead,
      route(async (_request, response) => {
        noStore(response);
        response.json(options.diagnosticMetrics!.snapshot());
      }),
    );
  }
  if (options.eventMetrics) {
    app.get(
      '/api/plugin-platform/v1/metrics/events',
      ...deploymentRead,
      route(async (_request, response) => {
        noStore(response);
        response.json(options.eventMetrics!.snapshot());
      }),
    );
  }
  app.get(
    '/api/plugin-platform/v1/events/dead-letters',
    ...deploymentRead,
    route(async (request, response) => {
      const cursor = queryCursor(request);
      const page = await eventOperations.listDeadLetters({
        limit: queryLimit(request),
        ...(cursor ? { cursor } : {}),
      });
      noStore(response);
      response.json(
        pluginEventDeadLetterListV1Schema.parse({
          apiVersion:
            'event-dead-letter-list.plugin.enterpriseglue.io/v1',
          items: page.items.map((item) => ({
            deliveryId: item.deliveryId,
            pluginId: item.pluginId,
            tenantScoped: true,
            subscriptionType: item.subscriptionType,
            attempt: item.attempt,
            maxAttempts: item.maxAttempts,
            reasonCode: item.reasonCode,
            createdAt: new Date(item.createdAt).toISOString(),
            updatedAt: new Date(item.updatedAt).toISOString(),
          })),
          nextCursor: page.nextCursor,
        }),
      );
    }),
  );
  app.get(
    '/api/plugin-platform/v1/plugins/:pluginId',
    ...deploymentRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.get(pluginIdFrom(request)),
      );
    }),
  );
  app.post(
    '/api/plugin-platform/v1/plugins/:pluginId/enable',
    ...deploymentManage,
    route(async (request, response) => {
      const input = pluginEnableRequestV1Schema.parse(request.body);
      noStore(response);
      response.json(
        await control.setDeploymentEnabled({
          pluginId: pluginIdFrom(request),
          enabled: true,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          actorRef: actorRef(request),
          correlationId: correlationId(request),
        }),
      );
    }),
  );
  app.post(
    '/api/plugin-platform/v1/plugins/:pluginId/events/dead-letters/:deliveryId/requeue',
    ...deploymentManage,
    route(async (request, response) => {
      const input = pluginEventDeadLetterRequeueRequestV1Schema.parse(
        request.body,
      );
      const result = await eventOperations.requeueDeadLetter({
        pluginId: pluginIdFrom(request),
        deliveryId: opaqueReferenceSchema.parse(
          request.params.deliveryId,
        ),
        expectedAttempt: input.expectedAttempt,
        actorRef: actorRef(request),
        correlationId: correlationId(request),
      });
      noStore(response);
      response.json(
        pluginEventDeadLetterRequeueResultV1Schema.parse({
          apiVersion:
            'event-dead-letter-requeue.plugin.enterpriseglue.io/v1',
          deliveryId: result.deliveryId,
          pluginId: result.pluginId,
          status: result.status,
          attempt: result.attempt,
          reasonCode: result.reasonCode,
          updatedAt: new Date(result.updatedAt).toISOString(),
        }),
      );
    }),
  );
  app.post(
    '/api/plugin-platform/v1/plugins/:pluginId/disable',
    ...deploymentManage,
    route(async (request, response) => {
      const input = pluginDisableRequestV1Schema.parse(request.body);
      noStore(response);
      response.json(
        await control.setDeploymentEnabled({
          pluginId: pluginIdFrom(request),
          enabled: false,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          actorRef: actorRef(request),
          correlationId: correlationId(request),
          reasonCode: disableReason(input.reason),
        }),
      );
    }),
  );
  app.get(
    '/api/plugin-platform/v1/operations/:operationId',
    ...deploymentRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.getOperation(
          opaqueReferenceSchema.parse(request.params.operationId),
        ),
      );
    }),
  );

  const getTenantEnablement = route(async (request, response) => {
      noStore(response);
      response.json(
        await control.getTenantEnablement(
          pluginIdFrom(request),
          tenantRef(request),
        ),
      );
    });
  const putTenantEnablement = route(async (request, response) => {
      const input = pluginTenantEnablementRequestV1Schema.parse(request.body);
      noStore(response);
      response.json(
        await control.setTenantEnabled({
          pluginId: pluginIdFrom(request),
          tenantRef: tenantRef(request),
          enabled: input.enabled,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          actorRef: actorRef(request),
          correlationId: correlationId(request),
        }),
      );
    });
  app.get(
    '/api/t/:tenantSlug/plugin-platform/v1/plugins/:pluginId/enablement',
    ...tenantRead,
    getTenantEnablement,
  );
  app.put(
    '/api/t/:tenantSlug/plugin-platform/v1/plugins/:pluginId/enablement',
    ...tenantManage,
    putTenantEnablement,
  );
  app.get(
    '/t/:tenantSlug/api/plugin-platform/v1/plugins/:pluginId/enablement',
    ...tenantRead,
    getTenantEnablement,
  );
  app.put(
    '/t/:tenantSlug/api/plugin-platform/v1/plugins/:pluginId/enablement',
    ...tenantManage,
    putTenantEnablement,
  );

  app.get(
    '/api/t/:tenantSlug/apps',
    ...tenantRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.listTenantApplications(
          tenantRef(request),
          tenantSlug(request),
        ),
      );
    }),
  );
  app.get(
    '/api/t/:tenantSlug/apps/:pluginId',
    ...tenantRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.getTenantApplication(
          pluginIdFrom(request),
          tenantRef(request),
          tenantSlug(request),
        ),
      );
    }),
  );
  app.get(
    '/api/t/:tenantSlug/apps/:pluginId/configuration',
    ...tenantRead,
    route(async (request, response) => {
      const application = await control.getTenantApplication(
        pluginIdFrom(request),
        tenantRef(request),
        tenantSlug(request),
      );
      noStore(response);
      response.json(application.configuration);
    }),
  );
  app.get(
    '/api/t/:tenantSlug/apps/:pluginId/audit',
    ...tenantRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.listTenantApplicationAudit(
          pluginIdFrom(request),
          tenantRef(request),
        ),
      );
    }),
  );
  app.get(
    '/api/t/:tenantSlug/apps/:pluginId/eligibility',
    ...tenantRead,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await control.getTenantEligibility(
          pluginIdFrom(request),
          tenantRef(request),
        ),
      );
    }),
  );
  app.put(
    '/api/workloads/tenants/:tenantId/apps/:pluginId/eligibility',
    ...eligibilityWorkload,
    route(async (request, response) => {
      const input = pluginTenantEligibilityApplyRequestV1Schema.parse(
        request.body,
      );
      noStore(response);
      response.json(await control.applyTenantEligibility({
        pluginId: pluginIdFrom(request),
        tenantRef: opaqueReferenceSchema.parse(request.params.tenantId),
        signedProjection: input.signedProjection,
        actorRef: workloadActorRef(request),
        correlationId: correlationId(request),
      }));
    }),
  );
  app.post(
    '/api/t/:tenantSlug/apps/:pluginId/activation-request',
    ...tenantRequest,
    route(async (request, response) => {
      const input = pluginTenantApplicationMutationRequestV1Schema.parse(
        request.body,
      );
      noStore(response);
      response.json(await control.requestTenantApplicationActivation({
        pluginId: pluginIdFrom(request),
        tenantRef: tenantRef(request),
        tenantSlug: tenantSlug(request),
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        actorRef: actorRef(request),
        correlationId: correlationId(request),
      }));
    }),
  );
  app.post(
    '/api/t/:tenantSlug/apps/:pluginId/activation-request/decision',
    ...tenantManage,
    route(async (request, response) => {
      const input = pluginTenantApplicationDecisionRequestV1Schema.parse(
        request.body,
      );
      noStore(response);
      response.json(await control.decideTenantApplicationActivation({
        pluginId: pluginIdFrom(request),
        tenantRef: tenantRef(request),
        tenantSlug: tenantSlug(request),
        decision: input.decision,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        actorRef: actorRef(request),
        correlationId: correlationId(request),
      }));
    }),
  );
  const setTenantApplicationActive = (active: boolean) =>
    route(async (request, response) => {
        const input = pluginTenantApplicationMutationRequestV1Schema.parse(
          request.body,
        );
        noStore(response);
        response.json(await control.setTenantApplicationActive({
          pluginId: pluginIdFrom(request),
          tenantRef: tenantRef(request),
          tenantSlug: tenantSlug(request),
          active,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          actorRef: actorRef(request),
          correlationId: correlationId(request),
        }));
      });
  app.post(
    '/api/t/:tenantSlug/apps/:pluginId/activate',
    ...tenantManage,
    setTenantApplicationActive(true),
  );
  app.post(
    '/api/t/:tenantSlug/apps/:pluginId/deactivate',
    ...tenantManage,
    setTenantApplicationActive(false),
  );
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    handler(request, response).catch((error: unknown) => {
      if (error instanceof PluginControlErrorV1) {
        noStore(response);
        response.status(error.status).json({ code: error.code });
        return;
      }
      if (error instanceof PluginTenantEligibilityVerificationErrorV1) {
        noStore(response);
        response.status(error.status).json({ code: error.code });
        return;
      }
      if (
        error &&
        typeof error === 'object' &&
        (error as { name?: unknown }).name === 'ZodError'
      ) {
        noStore(response);
        response.status(400).json({ code: 'request_invalid' });
        return;
      }
      if (
        error instanceof Error &&
        [
          'plugin_event_dead_letter_query_invalid',
          'plugin_event_dead_letter_cursor_invalid',
          'plugin_event_requeue_invalid',
        ].includes(error.message)
      ) {
        noStore(response);
        response.status(400).json({ code: 'request_invalid' });
        return;
      }
      if (
        error instanceof Error &&
        error.message === 'plugin_event_requeue_conflict'
      ) {
        noStore(response);
        response.status(409).json({ code: 'revision_conflict' });
        return;
      }
      next(error);
    });
  };
}

function pluginIdFrom(request: Request) {
  return pluginIdSchema.parse(request.params.pluginId);
}

function actorRef(request: Request): string {
  if (!request.user?.userId) {
    throw new PluginControlErrorV1(404, 'plugin_not_found');
  }
  return request.user.userId;
}

function workloadActorRef(request: Request): string {
  if (!request.serviceAccount?.id) {
    throw new PluginTenantEligibilityVerificationErrorV1(
      503,
      'eligibility_verifier_unavailable',
    );
  }
  return request.serviceAccount.id;
}

function tenantRef(request: Request): string {
  if (!request.tenant?.tenantId) {
    throw new PluginControlErrorV1(404, 'plugin_not_found');
  }
  return request.tenant.tenantId;
}

function tenantSlug(request: Request): string {
  if (!request.tenant?.tenantSlug) {
    throw new PluginControlErrorV1(404, 'plugin_not_found');
  }
  return request.tenant.tenantSlug;
}

function correlationId(request: Request): string {
  const candidate =
    headerValue(request.headers['x-request-id']) ??
    headerValue(request.headers['x-correlation-id']);
  return candidate && /^[A-Za-z0-9._:-]{1,256}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function queryLimit(request: Request): number {
  const raw = request.query.limit;
  if (raw === undefined) return 25;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,2}$/.test(raw)) {
    throw new Error('plugin_event_dead_letter_query_invalid');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 100) {
    throw new Error('plugin_event_dead_letter_query_invalid');
  }
  return value;
}

function queryCursor(request: Request): string | undefined {
  const raw = request.query.cursor;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error('plugin_event_dead_letter_cursor_invalid');
  }
  return opaqueReferenceSchema.parse(raw);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function disableReason(
  reason: 'administrator_request' | 'emergency' | 'dependency_change',
): PluginSafeReasonCodeV1 {
  if (reason === 'emergency') return 'emergency_disabled';
  if (reason === 'dependency_change') return 'dependency_missing';
  return 'administrator_disabled';
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}
