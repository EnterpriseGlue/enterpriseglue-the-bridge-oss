import {
  pluginInstallReviewV1Schema,
  pluginInstallationObservationV1Schema,
  pluginManagerCapabilityV1Schema,
} from '@enterpriseglue/plugin-sdk/manager';
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import { z } from 'zod';

import {
  PluginManagerStoreErrorV1,
  type PluginManagerStoreV1,
} from './pluginManagerStore.js';

const claimSchema = z
  .object({
    managerId: z.string().min(1).max(256),
    leaseDurationMs: z.number().int().min(5_000).max(300_000),
    occurredAt: z.string().datetime(),
  })
  .strict();

const renewSchema = z
  .object({
    installationId: z.string().min(1).max(256),
    leaseToken: z.string().min(16).max(500),
    expectedRevision: z.number().int().nonnegative(),
    leaseDurationMs: z.number().int().min(5_000).max(300_000),
    occurredAt: z.string().datetime(),
  })
  .strict();

const reviewPublicationSchema = z
  .object({
    leaseToken: z.string().min(16).max(500),
    expectedRevision: z.number().int().nonnegative(),
    review: pluginInstallReviewV1Schema,
  })
  .strict();

const observationPublicationSchema = z
  .object({
    leaseToken: z.string().min(16).max(500),
    expectedRevision: z.number().int().nonnegative(),
    observation: pluginInstallationObservationV1Schema,
  })
  .strict();

export interface PluginManagerInternalRouteOptionsV1 {
  middleware: RequestHandler[];
  managerIdentity(request: Request): string;
  platformRevision?: () => Promise<number>;
}

export function registerPluginManagerInternalRoutesV1(
  app: Express,
  store: PluginManagerStoreV1,
  options: PluginManagerInternalRouteOptionsV1,
): void {
  const identity = (request: Request): string => {
    const value = options.managerIdentity(request);
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
      throw new Error('plugin_manager_workload_identity_invalid');
    }
    return value;
  };

  app.put(
    '/api/plugin-platform/internal/v1/manager/capability',
    ...options.middleware,
    route(async (request, response) => {
      const capability = pluginManagerCapabilityV1Schema.parse(request.body);
      if (capability.managerId !== identity(request)) {
        response.status(403).json({ code: 'manager_identity_mismatch' });
        return;
      }
      await store.advertiseCapability(capability);
      noStore(response);
      response.status(204).end();
    }),
  );

  app.post(
    '/api/plugin-platform/internal/v1/installations:claim',
    ...options.middleware,
    route(async (request, response) => {
      const input = claimSchema.parse(request.body);
      if (input.managerId !== identity(request)) {
        response.status(403).json({ code: 'manager_identity_mismatch' });
        return;
      }
      const claim = await store.claim({
        ...input,
        currentPlatformRevision: options.platformRevision
          ? await options.platformRevision()
          : undefined,
      });
      noStore(response);
      response.json(claim ?? { intent: null });
    }),
  );

  app.post(
    '/api/plugin-platform/internal/v1/installations/:installationId/lease-renewal',
    ...options.middleware,
    route(async (request, response) => {
      void identity(request);
      const input = renewSchema.parse({
        ...request.body,
        installationId: request.params.installationId,
      });
      noStore(response);
      response.json(await store.renew(input));
    }),
  );

  app.put(
    '/api/plugin-platform/internal/v1/installations/:installationId/review',
    ...options.middleware,
    route(async (request, response) => {
      void identity(request);
      const input = reviewPublicationSchema.parse(request.body);
      if (input.review.installationId !== request.params.installationId) {
        response.status(409).json({ code: 'installation_identity_mismatch' });
        return;
      }
      noStore(response);
      response.json(await store.publishReview(input));
    }),
  );

  app.get(
    '/api/plugin-platform/internal/v1/installations/:installationId/approval',
    ...options.middleware,
    route(async (request, response) => {
      void identity(request);
      const reviewSha256 = singleQuery(request, 'reviewSha256');
      const planSha256 = singleQuery(request, 'planSha256');
      const result = await store.readApproval({
        installationId: firstParam(request.params.installationId),
        reviewSha256,
        planSha256,
      });
      noStore(response);
      response.json(result ?? { approval: null });
    }),
  );

  app.put(
    '/api/plugin-platform/internal/v1/installations/:installationId/observation',
    ...options.middleware,
    route(async (request, response) => {
      void identity(request);
      const input = observationPublicationSchema.parse(request.body);
      if (input.observation.installationId !== request.params.installationId) {
        response.status(409).json({ code: 'installation_identity_mismatch' });
        return;
      }
      noStore(response);
      response.json(await store.publishObservation(input));
    }),
  );
}

function singleQuery(request: Request, name: string): string {
  const value = request.query[name];
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`plugin_manager_${name}_invalid`);
  }
  return value;
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
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch((error: unknown) => {
      if (error instanceof PluginManagerStoreErrorV1) {
        response.status(error.status).json({ code: error.code });
        return;
      }
      next(error);
    });
  };
}
