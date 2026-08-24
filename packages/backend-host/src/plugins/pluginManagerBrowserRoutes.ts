import { randomUUID } from 'node:crypto';

import {
  ociDigestReferenceSchema,
  opaqueReferenceSchema,
  pluginDeploymentModeSchema,
  type PluginCatalogV2,
  pluginIdSchema,
  sha256Schema,
} from '@enterpriseglue/plugin-sdk';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';

import {
  PluginManagerStoreErrorV1,
  type PluginManagerStoreV1,
} from './pluginManagerStore.js';

const createIntentSchema = z
  .object({
    pluginId: pluginIdSchema,
    release: ociDigestReferenceSchema,
    operation: z.enum(['install', 'upgrade']).default('install'),
    fromVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).optional(),
    currentEnabled: z.boolean().optional(),
    source: z.enum(['connected_registry', 'offline_delivery', 'static_catalog']),
    deploymentMode: pluginDeploymentModeSchema,
    expectedPlatformRevision: z.number().int().nonnegative(),
    idempotencyKey: opaqueReferenceSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      (intent.operation === 'upgrade' &&
        (intent.fromVersion === undefined ||
          intent.currentEnabled === undefined)) ||
      (intent.operation === 'install' &&
        (intent.fromVersion !== undefined ||
          intent.currentEnabled !== undefined))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fromVersion'],
        message: 'Upgrade requests require fromVersion and currentEnabled',
      });
    }
  });

const approvalSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reviewSha256: sha256Schema,
    planSha256: sha256Schema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const recoverySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export interface PluginManagerBrowserRouteOptionsV1 {
  readMiddleware?: RequestHandler[];
  manageMiddleware?: RequestHandler[];
  now?: () => Date;
  catalog?: () => Promise<PluginCatalogV2 | null>;
  platformRevision?: () => Promise<number>;
}

export function registerPluginManagerBrowserRoutesV1(
  app: Express,
  store: PluginManagerStoreV1,
  options: PluginManagerBrowserRouteOptionsV1 = {},
): void {
  const read = options.readMiddleware ?? [
    apiLimiter,
    requireAuth,
    requireAction('platform.settings.read'),
  ];
  const manage = options.manageMiddleware ?? [
    apiLimiter,
    requireAuth,
    requireAction('platform.settings.manage'),
  ];
  const now = options.now ?? (() => new Date());

  app.get(
    '/api/plugin-platform/v1/catalog',
    ...read,
    route(async (_request, response) => {
      noStore(response);
      response.json({
        apiVersion: 'catalog-projection.plugin.enterpriseglue.io/v1',
        catalog: options.catalog ? await options.catalog() : null,
      });
    }),
  );

  app.get(
    '/api/plugin-platform/v1/manager',
    ...read,
    route(async (_request, response) => {
      const capability = await store.latestCapability();
      const observedAt = capability ? Date.parse(capability.observedAt) : Number.NaN;
      noStore(response);
      response.json({
        apiVersion: 'manager-status.plugin.enterpriseglue.io/v1',
        available:
          capability !== null &&
          Number.isFinite(observedAt) &&
          now().getTime() - observedAt <= 30_000,
        capability,
      });
    }),
  );

  app.get(
    '/api/plugin-platform/v1/installations',
    ...read,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await store.listInstallations({
          limit: boundedQueryInteger(request, 'limit', 25, 1, 100),
          offset: boundedQueryInteger(request, 'offset', 0, 0, 1_000_000),
        }),
      );
    }),
  );

  app.get(
    '/api/plugin-platform/v1/installations/:installationId',
    ...read,
    route(async (request, response) => {
      noStore(response);
      response.json(
        await store.getInstallation(
          opaqueReferenceSchema.parse(firstParam(request.params.installationId)),
        ),
      );
    }),
  );

  app.post(
    '/api/plugin-platform/v1/installations',
    ...manage,
    route(async (request, response) => {
      const input = createIntentSchema.parse(request.body);
      if (options.platformRevision) {
        const currentRevision = await options.platformRevision();
        if (currentRevision !== input.expectedPlatformRevision) {
          throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
        }
      }
      const requestedAt = now().toISOString();
      const intent = await store.createIntent({
        apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginInstallationIntent',
        installationId: `installation-${randomUUID()}`,
        ...input,
        requesterRef: actorRef(request),
        requestedAt,
      });
      noStore(response);
      response.status(201).json(intent);
    }),
  );

  app.post(
    '/api/plugin-platform/v1/installations/:installationId/approval',
    ...manage,
    route(async (request, response) => {
      const input = approvalSchema.parse(request.body);
      const installationId = opaqueReferenceSchema.parse(
        firstParam(request.params.installationId),
      );
      const summary = await store.getInstallation(installationId);
      const decidedAt = now().toISOString();
      const expiresAt = summary.review?.expiresAt;
      if (!expiresAt || Date.parse(expiresAt) <= Date.parse(decidedAt)) {
        throw new PluginManagerStoreErrorV1(409, 'approval_conflict');
      }
      noStore(response);
      response.json(
        await store.approve({
          apiVersion: 'install-approval.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginInstallApproval',
          installationId,
          ...input,
          approverRef: actorRef(request),
          decidedAt,
          expiresAt,
        }),
      );
    }),
  );

  app.post(
    '/api/plugin-platform/v1/installations/:installationId/cancel',
    ...manage,
    route(async (request, response) => {
      const input = recoverySchema.parse(request.body);
      noStore(response);
      response.json(await store.cancel({
        installationId: opaqueReferenceSchema.parse(firstParam(request.params.installationId)),
        expectedRevision: input.expectedRevision,
        occurredAt: now().toISOString(),
      }));
    }),
  );

  app.post(
    '/api/plugin-platform/v1/installations/:installationId/retry',
    ...manage,
    route(async (request, response) => {
      const input = recoverySchema.parse(request.body);
      noStore(response);
      response.json(await store.retry({
        installationId: opaqueReferenceSchema.parse(firstParam(request.params.installationId)),
        expectedRevision: input.expectedRevision,
        occurredAt: now().toISOString(),
      }));
    }),
  );
}

function boundedQueryInteger(
  request: Request,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = request.query[name];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error('plugin_manager_query_invalid');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('plugin_manager_query_invalid');
  }
  return value;
}

function actorRef(request: Request): string {
  if (!request.user?.userId) throw new Error('plugin_manager_actor_missing');
  return request.user.userId;
}

function firstParam(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) throw new Error('plugin_manager_route_parameter_invalid');
  return candidate;
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    handler(request, response).catch((error: unknown) => {
      if (error instanceof PluginManagerStoreErrorV1) {
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
          'plugin_manager_query_invalid',
          'plugin_manager_route_parameter_invalid',
          'plugin_manager_actor_missing',
        ].includes(error.message)
      ) {
        noStore(response);
        response.status(400).json({ code: 'request_invalid' });
        return;
      }
      next(error);
    });
  };
}
