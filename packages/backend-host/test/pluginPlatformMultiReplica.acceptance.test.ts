import 'reflect-metadata';

import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  parseEnterpriseGluePluginManifestV1,
  pluginMinorCompatibilityRangeV1,
  pluginPlatformReleaseIdentityV1,
  type EnterpriseGluePluginManifestV1,
  type PluginHostEventV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import {
  PluginGatewayCircuitBreakerV1,
  verifyPluginInvocationV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { AddPluginPlatform1700000000114 } from '@enterpriseglue/shared/db/migrations/1700000000114-add-plugin-platform.js';
import { AddPluginStorage1700000000116 } from '@enterpriseglue/shared/db/migrations/1700000000116-add-plugin-storage.js';
import { AddPluginEvents1700000000117 } from '@enterpriseglue/shared/db/migrations/1700000000117-add-plugin-events.js';
import { AddPluginEmergencyControl1700000000119 } from '@enterpriseglue/shared/db/migrations/1700000000119-add-plugin-emergency-control.js';
import { AddPluginGatewayAdmission1700000000120 } from '@enterpriseglue/shared/db/migrations/1700000000120-add-plugin-gateway-admission.js';
import { AddPluginEventCircuit1700000000121 } from '@enterpriseglue/shared/db/migrations/1700000000121-add-plugin-event-circuit.js';
import { ensureSpannerTypeOrmMigrationLedgerV1 } from '@enterpriseglue/shared/db/spanner-migration-ledger.js';
import { MySQLAdapter } from '@enterpriseglue/shared/db/adapters/MySQLAdapter.js';
import { OracleAdapter } from '@enterpriseglue/shared/db/adapters/OracleAdapter.js';
import { SpannerAdapter } from '@enterpriseglue/shared/db/adapters/SpannerAdapter.js';
import { SqlServerAdapter } from '@enterpriseglue/shared/db/adapters/SqlServerAdapter.js';
import { pluginPlatformEntities } from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import express, {
  type Express,
  type Request,
  type RequestHandler,
} from 'express';
import { DataSource } from 'typeorm';
import {
  Agent,
  fetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';
import { expect, it, vi } from 'vitest';

import {
  PluginControlPlaneV1,
} from '../src/plugins/pluginControlPlane.js';
import { DatabasePluginControlStoreV1 } from '../src/plugins/pluginControlStore.js';
import { PluginEventDispatcherV1 } from '../src/plugins/pluginEventDispatcher.js';
import { DatabasePluginEventDeliveryStoreV1 } from '../src/plugins/pluginEventDeliveryStore.js';
import { DatabasePluginGatewayAdmissionV1 } from '../src/plugins/pluginGatewayAdmissionStore.js';
import { DatabasePluginStorageStoreV1 } from '../src/plugins/pluginStorageStore.js';
import {
  defaultPluginHostCapabilitiesV1,
  PluginHostRuntimeV1,
  registerPluginPlatformRoutes,
} from '../src/plugins/pluginRuntime.js';

const pluginId = 'io.enterpriseglue.acceptance';
const pluginVersion = '1.0.0';
const operationId = `${pluginId}.create-case`;
const storageOperationId = `${pluginId}.store-cursor`;
const deniedOperationId = `${pluginId}.deployment-storage-denied`;
const eventOperationId = `${pluginId}.consume-incident`;
const secondaryPluginId = 'io.enterpriseglue.secondary-acceptance';
const secondaryPluginVersion = '1.0.0';
const secondaryStorageOperationId =
  `${secondaryPluginId}.store-cursor`;
const tenantRef = 'tenant-multi-replica';
const otherTenantRef = 'tenant-other';
const subjectRef = 'subject-multi-replica';
const deploymentRef = 'deployment-multi-replica';

function currentHostCompatibilityRange(): string {
  return pluginMinorCompatibilityRangeV1(
    pluginPlatformReleaseIdentityV1.hostVersion,
  );
}

function currentSdkCompatibilityRange(): string {
  return pluginMinorCompatibilityRangeV1(
    pluginPlatformReleaseIdentityV1.sdkVersion,
  );
}

type OperationMode = 'success' | 'hold' | 'crash' | 'timeout';
type EventMode = 'success' | 'unavailable';
type AcceptanceDatabaseType =
  | 'postgres'
  | 'mysql'
  | 'mssql'
  | 'oracle'
  | 'spanner';

interface Fixture {
  assetRoot: string;
  stateFile: string;
  manifest: EnterpriseGluePluginManifestV1;
  secondaryManifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  secondaryResources: PluginResourceDescriptorV1;
}

interface RunningServer {
  baseUrl: string;
  close(): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

/**
 * This acceptance is intentionally opt-in because it requires a disposable,
 * disposable PostgreSQL, MySQL, SQL Server, Oracle, or Spanner service. The
 * root wrappers provision it and supply the connection environment.
 */
it.skipIf(!process.env.ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL)(
  'isolates tenant storage, permissions, sidecar faults, and durable work across two host replicas',
  async () => {
    const databaseUrl =
      process.env.ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL!;
    const databaseType = acceptanceDatabaseType(databaseUrl);
    if (databaseType === 'mysql') {
      // Apply the same metadata normalization as the production MySQL adapter
      // before constructing any connected DataSource.
      new MySQLAdapter();
    } else if (databaseType === 'mssql') {
      // Apply the exact-length/collation/schema normalization used by the
      // production SQL Server adapter before constructing a DataSource.
      new SqlServerAdapter();
    } else if (databaseType === 'oracle') {
      // Map the shared main schema and portable column types to the isolated
      // Oracle acceptance user before constructing any DataSource.
      new OracleAdapter();
    } else if (databaseType === 'spanner') {
      // Apply the production Spanner metadata normalization before creating
      // the independent acceptance pools.
      new SpannerAdapter();
    }
    const migrationSource = acceptanceDataSource(databaseUrl, [
        AddPluginPlatform1700000000114,
        AddPluginStorage1700000000116,
        AddPluginEvents1700000000117,
        AddPluginEmergencyControl1700000000119,
        AddPluginGatewayAdmission1700000000120,
        AddPluginEventCircuit1700000000121,
    ]);
    const replicaSourceA = acceptanceDataSource(databaseUrl);
    const replicaSourceB = acceptanceDataSource(databaseUrl);
    const temporaryRoot = await mkdtemp(
      resolve(tmpdir(), 'eg-plugin-multi-replica-'),
    );
    const keyPair = generateKeyPairSync('ed25519');
    const privateKey = keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    const publicKey = keyPair.publicKey;
    const privateKeyFile = resolve(temporaryRoot, 'invocation-private.pem');
    await writeFile(privateKeyFile, privateKey);
    const previousPrivateKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    const previousDeploymentRef =
      process.env.ENTERPRISEGLUE_DEPLOYMENT_REF;
    const previousDispatcher = getGlobalDispatcher();
    const localNetwork = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address: '127.0.0.1', family: 4 }]);
            return;
          }
          callback(null, '127.0.0.1', 4);
        },
      },
    });
    const servers: RunningServer[] = [];
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;
    process.env.ENTERPRISEGLUE_DEPLOYMENT_REF = deploymentRef;
    setGlobalDispatcher(localNetwork);

    try {
      await migrationSource.initialize();
      if (databaseType === 'postgres') {
        await migrationSource.query('CREATE SCHEMA IF NOT EXISTS main');
      } else if (databaseType === 'mssql') {
        const schema = acceptanceSqlServerSchema();
        await migrationSource.query(
          `IF SCHEMA_ID(N'${schema}') IS NULL EXEC(N'CREATE SCHEMA [${schema}] AUTHORIZATION [dbo]')`,
        );
      } else if (databaseType === 'oracle') {
        const existingTables = await migrationSource.query(
          "SELECT table_name FROM user_tables WHERE LOWER(table_name) LIKE 'plugin_%'",
        );
        if (existingTables.length > 0) {
          throw new Error(
            'oracle_acceptance_schema_must_be_clean',
          );
        }
      }
      if (databaseType === 'spanner') {
        await ensureSpannerTypeOrmMigrationLedgerV1(
          migrationSource,
        );
      }
      await migrationSource.runMigrations({
        transaction:
          databaseType === 'spanner' ? 'none' : 'each',
      });
      await Promise.all([
        replicaSourceA.initialize(),
        replicaSourceB.initialize(),
      ]);

      let operationMode: OperationMode = 'success';
      let eventMode: EventMode = 'success';
      let operationEntered = deferred();
      let releaseOperation = deferred();
      let capabilityCalls = 0;
      let operationCalls = 0;
      let storageOperationCalls = 0;
      let deniedOperationCalls = 0;
      let eventCalls = 0;
      let secondaryCapabilityCalls = 0;
      let secondaryStorageOperationCalls = 0;
      let secondaryExpectedRevision: string | undefined;
      let brokerBaseUrl = '';
      let brokerCallSequence = 0;
      const verifiedClaims: Array<{
        operationId: string;
        subject: string;
        tenantRef?: string;
      }> = [];
      const consumedTokens = new Set<string>();
      let fixture: Fixture;

      const sidecar = express();
      sidecar.use(express.json({ limit: '64kb' }));
      sidecar.get('/_plugin/capabilities', (_request, response) => {
        capabilityCalls += 1;
        response.json(capabilities(fixture.manifest));
      });
      // lgtm[js/missing-rate-limiting] Ephemeral loopback-only acceptance fixture; production plugin operations are rate-limited by the host gateway before reaching a sidecar.
      sidecar.post('/v1/cases', async (request, response) => {
        operationCalls += 1;
        const claims = await verifyInvocation(
          request,
          publicKey,
          operationId,
          consumedTokens,
        );
        verifiedClaims.push({
          operationId: claims.operationId,
          subject: claims.sub,
          tenantRef: claims.tenantRef,
        });
        if (operationMode === 'hold') {
          operationEntered.resolve();
          await releaseOperation.promise;
        } else if (operationMode === 'crash') {
          request.socket.destroy();
          return;
        } else if (operationMode === 'timeout') {
          await delay(350);
          if (response.destroyed || response.writableEnded) return;
        }
        response.status(201).json({ caseRef: `case-${operationCalls}` });
      });
      // lgtm[js/missing-rate-limiting] Ephemeral loopback-only acceptance fixture; production plugin operations are rate-limited by the host gateway before reaching a sidecar.
      sidecar.post('/v1/storage/cursor', async (request, response) => {
        storageOperationCalls += 1;
        const invocationToken = request.header(
          'x-enterpriseglue-plugin-invocation',
        );
        const claims = await verifyInvocation(
          request,
          publicKey,
          storageOperationId,
          consumedTokens,
        );
        verifiedClaims.push({
          operationId: claims.operationId,
          subject: claims.sub,
          tenantRef: claims.tenantRef,
        });
        const brokerResponse = await fetch(
          `${brokerBaseUrl}/_enterpriseglue/plugin-broker/v1/${pluginId}/storage`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-enterpriseglue-plugin-invocation': invocationToken!,
            },
            body: JSON.stringify({
              apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
              callId: `acceptance-storage-${++brokerCallSequence}`,
              operationId: storageOperationId,
              action: 'put',
              scope: 'tenant',
              key: 'support/cursor',
              value: { cursor: 1, source: 'multi-replica-acceptance' },
            }),
          },
        );
        expect(brokerResponse.status).toBe(200);
        const result = (await brokerResponse.json()) as {
          revision: string;
        };
        response.status(200).json({ revision: result.revision });
      });
      sidecar.post('/v1/storage/deployment', (_request, response) => {
        deniedOperationCalls += 1;
        response.status(500).json({ error: 'must_not_be_called' });
      });
      // lgtm[js/missing-rate-limiting] Ephemeral loopback-only acceptance fixture; production plugin event delivery is admitted and rate-limited by the host.
      sidecar.post('/v1/events/incidents', async (request, response) => {
        eventCalls += 1;
        const claims = await verifyInvocation(
          request,
          publicKey,
          eventOperationId,
          consumedTokens,
        );
        verifiedClaims.push({
          operationId: claims.operationId,
          subject: claims.sub,
          tenantRef: claims.tenantRef,
        });
        if (eventMode === 'unavailable') {
          response.status(503).json({ error: 'synthetic_unavailable' });
          return;
        }
        response.status(200).json({
          apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
          deliveryId: request.body.deliveryId,
          status: 'accepted',
          reasonCode: 'accepted',
        });
      });
      const sidecarServer = await listen(sidecar);
      servers.push(sidecarServer);

      const secondarySidecar = express();
      secondarySidecar.use(express.json({ limit: '64kb' }));
      secondarySidecar.get(
        '/_plugin/capabilities',
        (_request, response) => {
          secondaryCapabilityCalls += 1;
          response.json(capabilities(fixture.secondaryManifest));
        },
      );
      // lgtm[js/missing-rate-limiting] Ephemeral loopback-only acceptance fixture; production plugin operations are rate-limited by the host gateway before reaching a sidecar.
      secondarySidecar.post(
        '/v1/storage/cursor',
        async (request, response) => {
          secondaryStorageOperationCalls += 1;
          const invocationToken = request.header(
            'x-enterpriseglue-plugin-invocation',
          );
          const claims = await verifyInvocation(
            request,
            publicKey,
            secondaryStorageOperationId,
            consumedTokens,
            secondaryPluginId,
          );
          verifiedClaims.push({
            operationId: claims.operationId,
            subject: claims.sub,
            tenantRef: claims.tenantRef,
          });
          const brokerResponse = await fetch(
            `${brokerBaseUrl}/_enterpriseglue/plugin-broker/v1/${secondaryPluginId}/storage`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-enterpriseglue-plugin-invocation':
                  invocationToken!,
              },
              body: JSON.stringify({
                apiVersion:
                  'storage-request.plugin.enterpriseglue.io/v1',
                callId:
                  `acceptance-secondary-storage-${++brokerCallSequence}`,
                operationId: secondaryStorageOperationId,
                action: 'put',
                scope: 'tenant',
                key: 'support/cursor',
                ...(secondaryExpectedRevision
                  ? { expectedRevision: secondaryExpectedRevision }
                  : {}),
                value: {
                  cursor: 2,
                  source: 'secondary-multi-replica-acceptance',
                },
              }),
            },
          );
          expect(brokerResponse.status).toBe(200);
          const result = (await brokerResponse.json()) as {
            revision: string;
          };
          secondaryExpectedRevision = result.revision;
          response.status(200).json({ revision: result.revision });
        },
      );
      const secondarySidecarServer = await listen(secondarySidecar);
      servers.push(secondarySidecarServer);

      fixture = await createFixture(
        temporaryRoot,
        Number(new URL(sidecarServer.baseUrl).port),
        Number(new URL(secondarySidecarServer.baseUrl).port),
      );
      const replicaA = createReplica(
        fixture,
        replicaSourceA,
        'replica-a',
        publicKey,
      );
      const replicaB = createReplica(
        fixture,
        replicaSourceB,
        'replica-b',
        publicKey,
      );
      const hostA = await listen(replicaA.app);
      const hostB = await listen(replicaB.app);
      servers.push(hostA, hostB);

      const invoke = (baseUrl: string) =>
        fetch(
          `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: { question: 'Why did this job fail?' },
            }),
          },
        );

      const invokeOperation = (
        baseUrl: string,
        requestedPluginId: string,
        requestedOperationId: string,
        tenantSlug = 'multi-replica',
      ) =>
        fetch(
          `${baseUrl}/t/${tenantSlug}/api/plugins/v1/${requestedPluginId}/operations/${requestedOperationId}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: {} }),
          },
        );

      brokerBaseUrl = hostA.baseUrl;
      const storedCursor = await invokeOperation(
        hostA.baseUrl,
        pluginId,
        storageOperationId,
      );
      expect(storedCursor.status).toBe(200);
      await expect(storedCursor.json()).resolves.toEqual({ revision: 'r1' });

      brokerBaseUrl = hostB.baseUrl;
      const secondaryStoredCursor = await invokeOperation(
        hostB.baseUrl,
        secondaryPluginId,
        secondaryStorageOperationId,
      );
      expect(secondaryStoredCursor.status).toBe(200);
      await expect(secondaryStoredCursor.json()).resolves.toEqual({
        revision: 'r1',
      });

      const secondaryCallsBeforeWrongOwner = {
        secondaryCapabilityCalls,
        secondaryStorageOperationCalls,
      };
      const wrongPluginOwner = await invokeOperation(
        hostA.baseUrl,
        secondaryPluginId,
        storageOperationId,
      );
      expect(wrongPluginOwner.status).toBe(404);
      expect({
        secondaryCapabilityCalls,
        secondaryStorageOperationCalls,
      }).toEqual(secondaryCallsBeforeWrongOwner);

      const callsBeforeDisabledTenant = {
        capabilityCalls,
        storageOperationCalls,
      };
      const disabledTenant = await invokeOperation(
        hostB.baseUrl,
        pluginId,
        storageOperationId,
        'other',
      );
      expect(disabledTenant.status).toBe(404);
      expect({ capabilityCalls, storageOperationCalls }).toEqual(
        callsBeforeDisabledTenant,
      );

      const capabilitiesBeforeDeniedPermission = capabilityCalls;
      const deniedPermission = await invokeOperation(
        hostB.baseUrl,
        pluginId,
        deniedOperationId,
      );
      expect(deniedPermission.status).toBe(403);
      await expect(deniedPermission.json()).resolves.toEqual({
        error: 'Plugin permission denied',
      });
      expect(capabilityCalls).toBe(capabilitiesBeforeDeniedPermission);
      expect(deniedOperationCalls).toBe(0);

      operationMode = 'hold';
      operationEntered = deferred();
      releaseOperation = deferred();
      const heldInvocation = invoke(hostA.baseUrl);
      await operationEntered.promise;
      const capabilitiesWhileHeld = capabilityCalls;
      const rejectedConcurrent = await invoke(hostB.baseUrl);
      expect(rejectedConcurrent.status).toBe(429);
      expect(capabilityCalls).toBe(capabilitiesWhileHeld);
      releaseOperation.resolve();
      expect((await heldInvocation).status).toBe(201);

      operationMode = 'success';
      expect((await invoke(hostB.baseUrl)).status).toBe(201);

      operationMode = 'crash';
      expect((await invoke(hostA.baseUrl)).status).toBe(502);
      const callsAfterCrash = {
        capabilityCalls,
        operationCalls,
      };
      expect((await invoke(hostA.baseUrl)).status).toBe(503);
      expect({ capabilityCalls, operationCalls }).toEqual(callsAfterCrash);
      brokerBaseUrl = hostA.baseUrl;
      const secondaryWhilePrimaryOpen = await invokeOperation(
        hostA.baseUrl,
        secondaryPluginId,
        secondaryStorageOperationId,
      );
      expect(secondaryWhilePrimaryOpen.status).toBe(200);
      await expect(secondaryWhilePrimaryOpen.json()).resolves.toEqual({
        revision: 'r2',
      });
      operationMode = 'success';
      expect((await invoke(hostB.baseUrl)).status).toBe(201);
      await delay(225);
      expect((await invoke(hostA.baseUrl)).status).toBe(201);

      operationMode = 'timeout';
      expect((await invoke(hostA.baseUrl)).status).toBe(502);
      const callsAfterTimeout = {
        capabilityCalls,
        operationCalls,
      };
      expect((await invoke(hostA.baseUrl)).status).toBe(503);
      expect({ capabilityCalls, operationCalls }).toEqual(callsAfterTimeout);
      operationMode = 'success';
      expect((await invoke(hostB.baseUrl)).status).toBe(201);
      await delay(225);
      expect((await invoke(hostA.baseUrl)).status).toBe(201);

      const ordinaryRoute = await fetch(
        `${hostA.baseUrl}/api/plugins/v1/frontend`,
      );
      expect(ordinaryRoute.status).toBe(200);
      await expect(ordinaryRoute.json()).resolves.toMatchObject({
        revision: 1,
        issues: [],
      });
      const unrelatedHealth = await fetch(
        `${hostB.baseUrl}/ordinary-health`,
      );
      expect(unrelatedHealth.status).toBe(200);
      await expect(unrelatedHealth.json()).resolves.toEqual({
        status: 'ok',
        replicaRef: 'replica-b',
      });

      eventMode = 'unavailable';
      const firstPublished = await replicaA.eventDispatcher.publish(
        incidentEvent('event-cross-replica-1'),
      );
      expect(firstPublished.queued).toHaveLength(1);
      const firstAttempt = await replicaA.eventDispatcher.runOnce();
      expect(firstAttempt).toHaveLength(1);
      expect(firstAttempt[0]).toMatchObject({
        status: 'retry_wait',
        attempt: 1,
        reasonCode: 'delivery_unavailable',
      });

      eventMode = 'success';
      await delayUntil(firstAttempt[0]!.nextAttemptAt);
      const drainedByReplicaB = await replicaB.eventDispatcher.runOnce();
      expect(drainedByReplicaB).toHaveLength(1);
      expect(drainedByReplicaB[0]).toMatchObject({
        status: 'delivered',
        attempt: 2,
        reasonCode: 'accepted',
      });

      await replicaA.eventDispatcher.publish(
        incidentEvent('event-competing-workers-2'),
      );
      const eventCallsBeforeRace = eventCalls;
      const competingResults = (
        await Promise.all([
          replicaA.eventDispatcher.runOnce(),
          replicaB.eventDispatcher.runOnce(),
        ])
      ).flat();
      expect(competingResults).toHaveLength(1);
      expect(competingResults[0]?.status).toBe('delivered');
      expect(eventCalls).toBe(eventCallsBeforeRace + 1);

      const admissionBuckets = await migrationSource.query(
        `SELECT ${acceptanceColumn(databaseType, 'bucket_hash')}
           FROM ${acceptanceTable(
             databaseType,
             'plugin_gateway_subject_buckets',
           )}`,
      );
      expect(admissionBuckets.length).toBeGreaterThan(0);
      expect(
        admissionBuckets.every(
          (row: { bucket_hash: string }) =>
            /^[a-f0-9]{64}$/.test(row.bucket_hash),
        ),
      ).toBe(true);
      expect(JSON.stringify(admissionBuckets)).not.toContain(tenantRef);
      expect(JSON.stringify(admissionBuckets)).not.toContain(subjectRef);
      const [leaseState] = await migrationSource.query(
        `SELECT COUNT(*) AS ${acceptanceAlias(databaseType, 'count')}
           FROM ${acceptanceTable(
             databaseType,
             'plugin_gateway_concurrency_leases',
           )}`,
      );
      expect(Number(leaseState.count)).toBe(0);
      const deliveredRows = await migrationSource.query(
        `SELECT
           ${acceptanceColumn(databaseType, 'status')},
           ${acceptanceColumn(databaseType, 'event_json')}
         FROM ${acceptanceTable(
           databaseType,
           'plugin_event_deliveries',
         )}
         ORDER BY ${acceptanceIdentifier(databaseType, 'delivery_id')}`,
      );
      expect(deliveredRows).toHaveLength(2);
      expect(
        deliveredRows.every(
          (row: { status: string; event_json: string }) =>
            row.status === 'delivered' && row.event_json === '{}',
        ),
      ).toBe(true);
      const storageRows = await migrationSource.query(
        `SELECT
           ${acceptanceColumn(databaseType, 'plugin_id')},
           ${acceptanceColumn(databaseType, 'scope')},
           ${acceptanceColumn(databaseType, 'tenant_ref_key')},
           ${acceptanceColumn(databaseType, 'storage_key')},
           ${acceptanceColumn(databaseType, 'value_json')},
           ${acceptanceColumn(databaseType, 'revision')}
         FROM ${acceptanceTable(
           databaseType,
           'plugin_storage_entries',
         )}
         ORDER BY ${acceptanceIdentifier(databaseType, 'plugin_id')}`,
      );
      expect(
        storageRows.map(
          (row: { revision: number | string } & Record<string, unknown>) => ({
            ...row,
            revision: String(row.revision),
          }),
        ),
      ).toEqual([
        {
          plugin_id: pluginId,
          scope: 'tenant',
          tenant_ref_key: tenantRef,
          storage_key: 'support/cursor',
          value_json: JSON.stringify({
            cursor: 1,
            source: 'multi-replica-acceptance',
          }),
          revision: '1',
        },
        {
          plugin_id: secondaryPluginId,
          scope: 'tenant',
          tenant_ref_key: tenantRef,
          storage_key: 'support/cursor',
          value_json: JSON.stringify({
            cursor: 2,
            source: 'secondary-multi-replica-acceptance',
          }),
          revision: '2',
        },
      ]);
      expect(
        storageRows.some(
          (row: { tenant_ref_key: string }) =>
            row.tenant_ref_key === otherTenantRef,
        ),
      ).toBe(false);

      expect(
        verifiedClaims.some(
          (claims) =>
            claims.operationId === operationId &&
            claims.subject === subjectRef &&
            claims.tenantRef === tenantRef,
        ),
      ).toBe(true);
      expect(
        verifiedClaims.some(
          (claims) =>
            claims.operationId === secondaryStorageOperationId &&
            claims.subject === subjectRef &&
            claims.tenantRef === tenantRef,
        ),
      ).toBe(true);
      expect(
        verifiedClaims.filter(
          (claims) => claims.operationId === eventOperationId,
        ),
      ).toHaveLength(3);
      expect(
        verifiedClaims
          .filter((claims) => claims.operationId === eventOperationId)
          .every(
            (claims) =>
              claims.subject === 'enterpriseglue-event-dispatcher' &&
              claims.tenantRef === tenantRef,
          ),
      ).toBe(true);

      const emergencyEvent = await replicaA.eventDispatcher.publish(
        incidentEvent('event-emergency-existing'),
      );
      expect(emergencyEvent.queued).toHaveLength(1);
      const callsBeforeEmergency = {
        capabilityCalls,
        operationCalls,
        eventCalls,
      };
      const emergencyStartedAt = performance.now();
      const disabled = await fetch(
        `${hostA.baseUrl}/api/plugin-platform/v1/emergency-control`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'multi-replica-emergency-disable',
          },
          body: JSON.stringify({
            disabled: true,
            expectedRevision: 0,
            idempotencyKey: 'multi-replica-emergency-disable-0001',
          }),
        },
      );
      expect(disabled.status).toBe(200);
      await expect(disabled.json()).resolves.toMatchObject({
        disabled: true,
        revision: 1,
        reasonCode: 'emergency_disabled',
      });
      const deniedAcrossReplica = await invoke(hostB.baseUrl);
      const emergencyPropagationMilliseconds =
        performance.now() - emergencyStartedAt;
      expect(deniedAcrossReplica.status).toBe(404);
      expect(emergencyPropagationMilliseconds).toBeLessThan(2_000);
      expect({
        capabilityCalls,
        operationCalls,
        eventCalls,
      }).toEqual(callsBeforeEmergency);

      const stateAcrossReplica = await fetch(
        `${hostB.baseUrl}/api/plugin-platform/v1/emergency-control`,
      );
      expect(stateAcrossReplica.status).toBe(200);
      await expect(stateAcrossReplica.json()).resolves.toMatchObject({
        disabled: true,
        revision: 1,
      });
      const rejectedExistingEvent =
        await replicaB.eventDispatcher.runOnce();
      expect(rejectedExistingEvent).toHaveLength(1);
      expect(rejectedExistingEvent[0]).toMatchObject({
        status: 'dead_letter',
        reasonCode: 'subscription_inactive',
      });
      expect(eventCalls).toBe(callsBeforeEmergency.eventCalls);
      const rejectedNewEvent = await replicaB.eventDispatcher.publish(
        incidentEvent('event-emergency-new'),
      );
      expect(rejectedNewEvent.queued).toHaveLength(0);
      expect(rejectedNewEvent.failed).toHaveLength(0);
      expect(
        (
          await fetch(`${hostA.baseUrl}/ordinary-health`)
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${hostB.baseUrl}/ordinary-health`)
        ).status,
      ).toBe(200);

      const resumed = await fetch(
        `${hostB.baseUrl}/api/plugin-platform/v1/emergency-control`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'multi-replica-emergency-resume',
          },
          body: JSON.stringify({
            disabled: false,
            expectedRevision: 1,
            idempotencyKey: 'multi-replica-emergency-resume-0001',
          }),
        },
      );
      expect(resumed.status).toBe(200);
      await expect(resumed.json()).resolves.toMatchObject({
        disabled: false,
        revision: 2,
        reasonCode: 'none',
      });
      operationMode = 'success';
      expect((await invoke(hostA.baseUrl)).status).toBe(201);
      const resumedEvent = await replicaA.eventDispatcher.publish(
        incidentEvent('event-emergency-resumed'),
      );
      expect(resumedEvent.queued).toHaveLength(1);
      const resumedEventResult =
        await replicaA.eventDispatcher.runOnce();
      expect(resumedEventResult).toHaveLength(1);
      expect(resumedEventResult[0]?.status).toBe('delivered');
      const emergencyAudit = await fetch(
        `${hostA.baseUrl}/api/plugin-platform/v1/audit`,
      );
      expect(emergencyAudit.status).toBe(200);
      const emergencyAuditBody = (await emergencyAudit.json()) as {
        events: Array<{ eventType: string }>;
      };
      expect(
        emergencyAuditBody.events.map((event) => event.eventType),
      ).toEqual(
        expect.arrayContaining([
          'platform_emergency_disabled',
          'platform_emergency_enabled',
        ]),
      );
    } finally {
      consoleError.mockRestore();
      for (const server of servers.reverse()) {
        await server.close().catch(() => undefined);
      }
      setGlobalDispatcher(previousDispatcher);
      await localNetwork.close().catch(() => undefined);
      for (const source of [
        replicaSourceA,
        replicaSourceB,
        migrationSource,
      ]) {
        if (source.isInitialized) await source.destroy();
      }
      if (previousPrivateKeyFile === undefined) {
        delete process.env
          .ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousPrivateKeyFile;
      }
      if (previousDeploymentRef === undefined) {
        delete process.env.ENTERPRISEGLUE_DEPLOYMENT_REF;
      } else {
        process.env.ENTERPRISEGLUE_DEPLOYMENT_REF =
          previousDeploymentRef;
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
  60_000,
);

function createReplica(
  fixture: Fixture,
  source: DataSource,
  replicaRef: string,
  publicKey: KeyObject,
) {
  const runtime = new PluginHostRuntimeV1({
    stateFile: fixture.stateFile,
    assetRoot: fixture.assetRoot,
    hostCapabilities: defaultPluginHostCapabilitiesV1(),
  });
  const control = new PluginControlPlaneV1(
    runtime,
    new DatabasePluginControlStoreV1(async () => source),
    { defaultTenantRef: tenantRef },
  );
  const admission = new DatabasePluginGatewayAdmissionV1(
    {
      windowMs: 60_000,
      maxRequestsPerSubjectOperation: 1_000,
      maxRequestsPerPlugin: 2_000,
      maxConcurrentPerOperation: 1,
      maxTrackedBuckets: 1_000,
    },
    async () => source,
  );
  const eventStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
    {},
    {
      failureThreshold: 3,
      openMilliseconds: 1_000,
    },
  );
  const eventDispatcher = new PluginEventDispatcherV1(runtime, control, {
    deploymentRef,
    invocationPrivateKey: async () =>
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE
        ? readFile(
            process.env
              .ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE,
            'utf8',
          )
        : Promise.reject(new Error('missing acceptance key')),
    store: eventStore,
    workerRef: `event-${replicaRef}`,
  });
  const app = express();
  const brokerReplayKeys = new Set<string>();
  app.use(express.json({ limit: '64kb' }));
  app.get('/ordinary-health', (_request, response) => {
    response.status(200).json({ status: 'ok', replicaRef });
  });
  registerPluginPlatformRoutes(app, runtime, control, {
    operationMiddleware: [authenticatedPluginRequest()],
    gatewayAdmission: admission,
    gatewayCircuitBreaker: new PluginGatewayCircuitBreakerV1({
      failureThreshold: 1,
      openMs: 200,
    }),
    operationAuthorizer: async (input) =>
      input.actionId === 'platform.dashboard.read' &&
      input.subjectRef === subjectRef &&
      input.tenantRef === tenantRef,
    eventDispatcher,
    startEventWorker: false,
    startScheduleWorker: false,
    startAvailabilityWorker: false,
    startEngineEventPoller: false,
    controlRouteMiddleware: {
      deploymentAdminMiddleware: [authenticatedPlatformAdmin()],
      tenantAdminMiddleware: [authenticatedPlatformAdmin()],
    },
    hostBroker: {
      invocationPublicKey: async () =>
        publicKey.export({ type: 'spki', format: 'pem' }),
      expectedDeploymentRef: deploymentRef,
      storageStore: new DatabasePluginStorageStoreV1(async () => source),
      replayStoreFactory: (requestedPluginId, callId) => ({
        consume: async (jti) => {
          const key = `${requestedPluginId}\0${callId}\0${jti}`;
          if (brokerReplayKeys.has(key)) return false;
          brokerReplayKeys.add(key);
          return true;
        },
      }),
    },
  });
  return { app, runtime, control, eventDispatcher };
}

function acceptanceDataSource(
  databaseUrl: string,
  migrations: Array<
    | typeof AddPluginPlatform1700000000114
    | typeof AddPluginEvents1700000000117
    | typeof AddPluginStorage1700000000116
    | typeof AddPluginEmergencyControl1700000000119
    | typeof AddPluginGatewayAdmission1700000000120
    | typeof AddPluginEventCircuit1700000000121
  > = [],
): DataSource {
  if (acceptanceDatabaseType(databaseUrl) === 'mysql') {
    return new DataSource({
      type: 'mysql',
      url: databaseUrl,
      charset: 'utf8mb4',
      entities: [...pluginPlatformEntities],
      migrations,
      synchronize: false,
    });
  }
  if (acceptanceDatabaseType(databaseUrl) === 'mssql') {
    return new DataSource({
      type: 'mssql',
      host: requiredAcceptanceEnvironment('MSSQL_HOST'),
      port: Number(requiredAcceptanceEnvironment('MSSQL_PORT')),
      username: requiredAcceptanceEnvironment('MSSQL_USER'),
      password: requiredAcceptanceEnvironment('MSSQL_PASSWORD'),
      database: requiredAcceptanceEnvironment('MSSQL_DATABASE'),
      schema: acceptanceSqlServerSchema(),
      options: {
        encrypt: acceptanceEnvironmentBoolean('MSSQL_ENCRYPT'),
        trustServerCertificate: acceptanceEnvironmentBoolean(
          'MSSQL_TRUST_SERVER_CERTIFICATE',
        ),
      },
      entities: [...pluginPlatformEntities],
      migrations,
      migrationsTableName: 'plugin_acceptance_migrations',
      synchronize: false,
    });
  }
  if (acceptanceDatabaseType(databaseUrl) === 'oracle') {
    return new DataSource({
      type: 'oracle',
      username: requiredAcceptanceEnvironment('ORACLE_USER'),
      password: requiredAcceptanceEnvironment('ORACLE_PASSWORD'),
      connectString:
        `${requiredAcceptanceEnvironment('ORACLE_HOST')}:` +
        `${requiredAcceptanceEnvironment('ORACLE_PORT')}/` +
        requiredAcceptanceEnvironment('ORACLE_SERVICE_NAME'),
      schema: acceptanceOracleSchema(),
      entities: [...pluginPlatformEntities],
      migrations,
      migrationsTableName: 'plugin_acceptance_migrations',
      synchronize: false,
    });
  }
  if (acceptanceDatabaseType(databaseUrl) === 'spanner') {
    return new DataSource({
      type: 'spanner',
      projectId: requiredAcceptanceEnvironment(
        'SPANNER_PROJECT_ID',
      ),
      instanceId: requiredAcceptanceEnvironment(
        'SPANNER_INSTANCE_ID',
      ),
      databaseId: requiredAcceptanceEnvironment(
        'SPANNER_DATABASE_ID',
      ),
      entities: [...pluginPlatformEntities],
      migrations,
      synchronize: false,
    });
  }
  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    schema: 'main',
    entities: [...pluginPlatformEntities],
    migrations,
    synchronize: false,
  });
}

function acceptanceDatabaseType(
  databaseUrl: string,
): AcceptanceDatabaseType {
  if (databaseUrl.startsWith('mssql://')) return 'mssql';
  if (databaseUrl.startsWith('oracle://')) return 'oracle';
  if (databaseUrl.startsWith('spanner://')) return 'spanner';
  return databaseUrl.startsWith('mysql://') ||
    databaseUrl.startsWith('mariadb://')
    ? 'mysql'
    : 'postgres';
}

function acceptanceTable(
  databaseType: AcceptanceDatabaseType,
  tableName: string,
): string {
  if (databaseType === 'postgres') return `main.${tableName}`;
  if (databaseType === 'mssql') {
    return `[${acceptanceSqlServerSchema()}].[${tableName}]`;
  }
  if (databaseType === 'oracle') {
    return `"${acceptanceOracleSchema()}"."${tableName}"`;
  }
  return tableName;
}

function acceptanceIdentifier(
  databaseType: AcceptanceDatabaseType,
  identifier: string,
): string {
  return databaseType === 'oracle' ? `"${identifier}"` : identifier;
}

function acceptanceAlias(
  databaseType: AcceptanceDatabaseType,
  alias: string,
): string {
  return databaseType === 'oracle' ? `"${alias}"` : alias;
}

function acceptanceColumn(
  databaseType: AcceptanceDatabaseType,
  columnName: string,
): string {
  const identifier = acceptanceIdentifier(databaseType, columnName);
  return databaseType === 'oracle'
    ? `${identifier} AS "${columnName}"`
    : identifier;
}

function acceptanceSqlServerSchema(): string {
  const schema = requiredAcceptanceEnvironment('MSSQL_SCHEMA');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(schema)) {
    throw new Error('invalid_mssql_acceptance_schema');
  }
  return schema;
}

function acceptanceOracleSchema(): string {
  const schema = requiredAcceptanceEnvironment('ORACLE_SCHEMA');
  if (!/^[A-Z][A-Z0-9_$#]{0,127}$/.test(schema)) {
    throw new Error('invalid_oracle_acceptance_schema');
  }
  return schema;
}

function acceptanceEnvironmentBoolean(name: string): boolean {
  const value = requiredAcceptanceEnvironment(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`invalid_boolean_environment_${name}`);
}

function requiredAcceptanceEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_acceptance_environment_${name}`);
  return value;
}

function authenticatedPluginRequest(): RequestHandler {
  return (request, _response, next) => {
    const tenantSlug =
      typeof request.params.tenantSlug === 'string'
        ? request.params.tenantSlug
        : 'multi-replica';
    const resolvedTenantRef =
      tenantSlug === 'other' ? otherTenantRef : tenantRef;
    Object.assign(request, {
      user: { userId: subjectRef },
      tenant: {
        tenantId: resolvedTenantRef,
        tenantSlug,
      },
    });
    next();
  };
}

function authenticatedPlatformAdmin(): RequestHandler {
  return (request, _response, next) => {
    request.user = {
      userId: 'multi-replica-platform-admin',
      platformRole: 'admin',
    } as NonNullable<typeof request.user>;
    request.tenant = {
      tenantId: tenantRef,
      tenantSlug: 'multi-replica',
    };
    next();
  };
}

async function createFixture(
  temporaryRoot: string,
  sidecarPort: number,
  secondarySidecarPort: number,
): Promise<Fixture> {
  const assetRoot = resolve(temporaryRoot, 'assets');
  const schemaRoot = resolve(assetRoot, pluginId, 'schemas');
  const secondarySchemaRoot = resolve(
    assetRoot,
    secondaryPluginId,
    'schemas',
  );
  await Promise.all([
    mkdir(schemaRoot, { recursive: true }),
    mkdir(secondarySchemaRoot, { recursive: true }),
  ]);
  const schemas = {
    questionRequest: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 1_000 },
      },
    }),
    questionResponse: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['caseRef'],
      properties: {
        caseRef: { type: 'string', minLength: 1, maxLength: 128 },
      },
    }),
    storageRequest: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    }),
    storageResponse: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['revision'],
      properties: {
        revision: { type: 'string', pattern: '^r[1-9][0-9]*$' },
      },
    }),
    eventRequest: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: [
        'apiVersion',
        'deliveryId',
        'operationId',
        'subscriptionType',
        'attempt',
        'event',
      ],
      properties: {
        apiVersion: {
          const: 'event-delivery.plugin.enterpriseglue.io/v1',
        },
        deliveryId: { type: 'string', minLength: 1 },
        operationId: { const: eventOperationId },
        subscriptionType: {
          const: 'io.enterpriseglue.host.incident.v1',
        },
        attempt: { type: 'integer', minimum: 1, maximum: 100 },
        event: { type: 'object' },
      },
    }),
    eventResponse: schemaBytes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['apiVersion', 'deliveryId', 'status', 'reasonCode'],
      properties: {
        apiVersion: {
          const: 'event-receipt.plugin.enterpriseglue.io/v1',
        },
        deliveryId: { type: 'string', minLength: 1 },
        status: {
          enum: [
            'accepted',
            'duplicate',
            'retryable_rejected',
            'permanent_rejected',
          ],
        },
        reasonCode: {
          type: 'string',
          pattern: '^[a-z][a-z0-9_]*$',
        },
      },
    }),
  };
  await Promise.all([
    writeFile(
      resolve(schemaRoot, 'create-case.request.json'),
      schemas.questionRequest,
    ),
    writeFile(
      resolve(schemaRoot, 'create-case.response.json'),
      schemas.questionResponse,
    ),
    writeFile(
      resolve(schemaRoot, 'storage.request.json'),
      schemas.storageRequest,
    ),
    writeFile(
      resolve(schemaRoot, 'storage.response.json'),
      schemas.storageResponse,
    ),
    writeFile(
      resolve(secondarySchemaRoot, 'storage.request.json'),
      schemas.storageRequest,
    ),
    writeFile(
      resolve(secondarySchemaRoot, 'storage.response.json'),
      schemas.storageResponse,
    ),
    writeFile(
      resolve(schemaRoot, 'event-delivery.request.json'),
      schemas.eventRequest,
    ),
    writeFile(
      resolve(schemaRoot, 'event-delivery.response.json'),
      schemas.eventResponse,
    ),
  ]);

  const manifest = parseEnterpriseGluePluginManifestV1({
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version: pluginVersion,
      displayName: 'Multi-replica acceptance plugin',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: currentHostCompatibilityRange(),
      sdk: currentSdkCompatibilityRange(),
      backendProtocol: 1,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: `registry.example/acceptance@sha256:${'b'.repeat(64)}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId,
            method: 'POST',
            path: 'v1/cases',
            requestSchema: {
              path: 'schemas/create-case.request.json',
              sha256: sha256(schemas.questionRequest),
            },
            responseSchema: {
              path: 'schemas/create-case.response.json',
              sha256: sha256(schemas.questionResponse),
            },
            requiredPermissions: ['host.identity.read_safe'],
            maxRequestBytes: 8_192,
            maxResponseBytes: 8_192,
            timeoutMs: 150,
            streaming: 'none',
          },
          {
            operationId: eventOperationId,
            method: 'POST',
            path: 'v1/events/incidents',
            requestSchema: {
              path: 'schemas/event-delivery.request.json',
              sha256: sha256(schemas.eventRequest),
            },
            responseSchema: {
              path: 'schemas/event-delivery.response.json',
              sha256: sha256(schemas.eventResponse),
            },
            requiredPermissions: ['host.events.subscribe.incident'],
            maxRequestBytes: 16_384,
            maxResponseBytes: 4_096,
            timeoutMs: 1_000,
            streaming: 'none',
          },
          {
            operationId: storageOperationId,
            method: 'POST',
            path: 'v1/storage/cursor',
            requestSchema: {
              path: 'schemas/storage.request.json',
              sha256: sha256(schemas.storageRequest),
            },
            responseSchema: {
              path: 'schemas/storage.response.json',
              sha256: sha256(schemas.storageResponse),
            },
            requiredPermissions: ['host.plugin_storage.tenant'],
            maxRequestBytes: 1_024,
            maxResponseBytes: 1_024,
            timeoutMs: 1_000,
            streaming: 'none',
          },
          {
            operationId: deniedOperationId,
            method: 'POST',
            path: 'v1/storage/deployment',
            requestSchema: {
              path: 'schemas/storage.request.json',
              sha256: sha256(schemas.storageRequest),
            },
            responseSchema: {
              path: 'schemas/storage.response.json',
              sha256: sha256(schemas.storageResponse),
            },
            requiredPermissions: ['host.plugin_storage.deployment'],
            maxRequestBytes: 1_024,
            maxResponseBytes: 1_024,
            timeoutMs: 1_000,
            streaming: 'none',
          },
        ],
      },
    },
    scope: { installation: 'deployment', enablement: 'tenant' },
    permissions: {
      required: [
        'host.identity.read_safe',
        'host.events.subscribe.incident',
        'host.plugin_storage.tenant',
      ],
      optional: ['host.plugin_storage.deployment'],
    },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'none' },
    dependencies: [],
    conflicts: [],
    events: {
      subscriptions: [
        {
          type: 'io.enterpriseglue.host.incident.v1',
          deliveryOperationId: eventOperationId,
          schema: {
            path: 'schemas/event-delivery.request.json',
            sha256: sha256(schemas.eventRequest),
          },
          permission: 'host.events.subscribe.incident',
          maxAttempts: 3,
        },
      ],
    },
    jobs: { fixedSchedules: [] },
    contributions: [],
  });
  const secondaryManifest = parseEnterpriseGluePluginManifestV1({
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: secondaryPluginId,
      version: secondaryPluginVersion,
      displayName: 'Secondary acceptance plugin',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: currentHostCompatibilityRange(),
      sdk: currentSdkCompatibilityRange(),
      backendProtocol: 1,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: `registry.example/secondary-acceptance@sha256:${'e'.repeat(64)}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId: secondaryStorageOperationId,
            method: 'POST',
            path: 'v1/storage/cursor',
            requestSchema: {
              path: 'schemas/storage.request.json',
              sha256: sha256(schemas.storageRequest),
            },
            responseSchema: {
              path: 'schemas/storage.response.json',
              sha256: sha256(schemas.storageResponse),
            },
            requiredPermissions: ['host.plugin_storage.tenant'],
            maxRequestBytes: 1_024,
            maxResponseBytes: 1_024,
            timeoutMs: 1_000,
            streaming: 'none',
          },
        ],
      },
    },
    scope: { installation: 'deployment', enablement: 'tenant' },
    permissions: {
      required: ['host.plugin_storage.tenant'],
      optional: [],
    },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'none' },
    dependencies: [],
    conflicts: [],
    events: { subscriptions: [] },
    jobs: { fixedSchedules: [] },
    contributions: [],
  });
  const resources = pluginResources(sidecarPort);
  const secondaryResources = pluginResources(secondarySidecarPort);
  const stateFile = resolve(temporaryRoot, 'plugin-installer-state.json');
  await writeFile(
    stateFile,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      plugins: {
        [pluginId]: {
          pluginId,
          version: pluginVersion,
          bundle: `registry.example/acceptance-bundle@sha256:${'c'.repeat(64)}`,
          manifestSha256: 'd'.repeat(64),
          manifest,
          resources,
          grantedPermissions: [
            'host.identity.read_safe',
            'host.events.subscribe.incident',
            'host.plugin_storage.tenant',
          ],
          enabled: true,
        },
        [secondaryPluginId]: {
          pluginId: secondaryPluginId,
          version: secondaryPluginVersion,
          bundle: `registry.example/secondary-acceptance-bundle@sha256:${'f'.repeat(64)}`,
          manifestSha256: 'a'.repeat(64),
          manifest: secondaryManifest,
          resources: secondaryResources,
          grantedPermissions: ['host.plugin_storage.tenant'],
          enabled: true,
        },
      },
    }),
  );
  return {
    assetRoot,
    stateFile,
    manifest,
    secondaryManifest,
    resources,
    secondaryResources,
  };
}

function pluginResources(
  sidecarPort: number,
): PluginResourceDescriptorV1 {
  return {
    apiVersion: 'resources.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginResources',
    service: {
      containerPort: sidecarPort,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      tmpfsMiB: 32,
      cpuLimit: '250m',
      memoryLimitMiB: 256,
    },
    configuration: [],
    storage: [],
    network: { ingress: 'host-gateway-only', egressPolicy: 'none' },
    probes: {
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      initialDelaySeconds: 1,
      periodSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
    },
  };
}

function capabilities(manifest: EnterpriseGluePluginManifestV1) {
  return {
    protocol: 'backend.plugin.enterpriseglue.io/v1',
    pluginId: manifest.metadata.id,
    pluginVersion: manifest.metadata.version,
    apiRevision: '1',
    schemaRevision: 1,
    operations:
      manifest.deployment.backend?.operations.map((operation) => ({
        operationId: operation.operationId,
        requestSchemaSha256: operation.requestSchema.sha256,
        responseSchemaSha256: operation.responseSchema.sha256,
      })) ?? [],
    optionalFeatures: [],
  };
}

async function verifyInvocation(
  request: Request,
  publicKey: KeyObject,
  expectedOperationId: string,
  consumedTokens: Set<string>,
  expectedPluginId = pluginId,
) {
  const token = request.header(
    'x-enterpriseglue-plugin-invocation',
  );
  if (!token) throw new Error('missing invocation token');
  return verifyPluginInvocationV1({
    token,
    publicKey,
    expectedAudience: expectedPluginId,
    expectedOperationId,
    replayStore: {
      consume: async (jti) => {
        if (consumedTokens.has(jti)) return false;
        consumedTokens.add(jti);
        return true;
      },
    },
  });
}

function incidentEvent(id: string): PluginHostEventV1 {
  return {
    specversion: '1.0',
    id,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `incident-${id}`,
    time: '2026-07-26T00:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef,
    data: {
      engineRef: 'engine-acceptance',
      incidentRef: `incident-${id}`,
      incidentType: 'failedJob',
    },
  };
}

async function listen(app: Express): Promise<RunningServer> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolvePromise, reject) => {
    server.once('listening', resolvePromise);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections();
  server.closeAllConnections();
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) =>
      error ? reject(error) : resolvePromise(),
    );
  });
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function schemaBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function delayUntil(epochMilliseconds: number): Promise<void> {
  await delay(Math.max(0, epochMilliseconds - Date.now() + 25));
}
