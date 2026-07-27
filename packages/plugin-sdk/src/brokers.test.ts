import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

import {
  permissionForResourceKindV1,
  pluginDiagnosticCollectionRequestV1Schema,
  pluginDiagnosticCollectorStatusRequestV1Schema,
  pluginDiagnosticCollectorStatusResponseV1Schema,
  pluginEventDeliveryV1Schema,
  pluginFixedScheduleRequestV1Schema,
  pluginIdentityRequestV1Schema,
  pluginNotificationPublishRequestV1Schema,
  pluginResourceMetadataRequestV1Schema,
  pluginDiagnosticBundleSignaturePayloadV1,
  pluginSanitizedDiagnosticBundleV1Schema,
  pluginStorageRequestV1Schema,
} from './brokers.js';

const common = {
  callId: 'broker-call-1',
  operationId: 'io.enterpriseglue.example.analyze-incident',
};

describe('closed host broker contracts', () => {
  it('accepts identity and minimized resource requests', () => {
    expect(
      pluginIdentityRequestV1Schema.parse({
        apiVersion: 'identity-request.plugin.enterpriseglue.io/v1',
        ...common,
      }).callId,
    ).toBe(common.callId);
    expect(
      pluginResourceMetadataRequestV1Schema.parse({
        apiVersion: 'resource-request.plugin.enterpriseglue.io/v1',
        ...common,
        kind: 'incident',
        engineRef: 'engine-1',
        incidentRef: 'incident-1',
      }).kind,
    ).toBe('incident');
    expect(permissionForResourceKindV1('failed_job')).toBe(
      'host.engine.failed_jobs.read_metadata',
    );
  });

  it('rejects arbitrary resource kinds and extra fields', () => {
    expect(
      pluginResourceMetadataRequestV1Schema.safeParse({
        apiVersion: 'resource-request.plugin.enterpriseglue.io/v1',
        ...common,
        kind: 'raw_engine_object',
        engineRef: 'engine-1',
        resourceRef: 'anything',
      }).success,
    ).toBe(false);
    expect(
      pluginIdentityRequestV1Schema.safeParse({
        apiVersion: 'identity-request.plugin.enterpriseglue.io/v1',
        ...common,
        tenantRef: 'caller-selected-tenant',
      }).success,
    ).toBe(false);
  });

  it('accepts bounded storage operations and rejects traversal keys', () => {
    expect(
      pluginStorageRequestV1Schema.parse({
        apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
        ...common,
        action: 'put',
        scope: 'tenant',
        key: 'automation/cursor',
        value: { cursor: 12 },
        expectedRevision: 'r2',
      }).action,
    ).toBe('put');
    expect(
      pluginStorageRequestV1Schema.safeParse({
        apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
        ...common,
        action: 'get',
        scope: 'tenant',
        key: 'automation/../other-plugin',
      }).success,
    ).toBe(false);
  });

  it('accepts minimized event delivery without raw incident text', () => {
    expect(
      pluginEventDeliveryV1Schema.parse({
        apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
        deliveryId: 'delivery-1',
        operationId: 'io.enterpriseglue.example.consume-incident',
        subscriptionType: 'io.enterpriseglue.host.incident.v1',
        attempt: 1,
        event: {
          specversion: '1.0',
          id: 'event-1',
          source: 'enterpriseglue-oss',
          type: 'io.enterpriseglue.host.incident.v1',
          subject: 'incident-1',
          time: '2026-07-24T00:00:00.000Z',
          dataschema:
            'https://schemas.enterpriseglue.io/events/incident-v1.json',
          tenantRef: 'tenant-1',
          data: {
            engineRef: 'engine-1',
            incidentRef: 'incident-1',
            incidentType: 'failedJob',
          },
        },
      }).event.data,
    ).not.toHaveProperty('errorMessage');
  });

  it('accepts only the closed daily engine inventory shape', () => {
    const delivery = {
      apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: 'delivery-inventory-1',
      operationId: 'io.enterpriseglue.example.consume-engine-inventory',
      subscriptionType:
        'io.enterpriseglue.host.engine-inventory.v1',
      attempt: 1,
      event: {
        specversion: '1.0',
        id: 'event-inventory-1',
        source: 'enterpriseglue-oss',
        type: 'io.enterpriseglue.host.engine-inventory.v1',
        subject: 'engine-1',
        time: '2026-07-27T00:00:00.000Z',
        dataschema:
          'https://schemas.enterpriseglue.io/events/engine-inventory-v1.json',
        tenantRef: 'tenant-1',
        data: {
          engineRef: 'engine-1',
          product: 'operaton',
          version: '2.1.2',
          observedAtBucket: '2026-07-27T00:00:00.000Z',
        },
      },
    };

    expect(
      pluginEventDeliveryV1Schema.parse(delivery).event.data,
    ).toEqual({
      engineRef: 'engine-1',
      product: 'operaton',
      version: '2.1.2',
      observedAtBucket: '2026-07-27T00:00:00.000Z',
    });
    expect(
      pluginEventDeliveryV1Schema.safeParse({
        ...delivery,
        event: {
          ...delivery.event,
          data: {
            ...delivery.event.data,
            engineName: 'customer-production',
            endpoint: 'https://engine.customer.invalid',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('makes raw diagnostic upload impossible in the request contract', () => {
    expect(
      pluginDiagnosticCollectionRequestV1Schema.parse({
        apiVersion:
          'diagnostic-collection-request.plugin.enterpriseglue.io/v1',
        ...common,
        engineRef: 'engine-1',
        trigger: { kind: 'incident', incidentRef: 'incident-1' },
        profile: 'incident_minimal',
        mode: 'sanitized_bundle_auto',
        idempotencyKey: 'diagnostic-intent-1',
      }).mode,
    ).toBe('sanitized_bundle_auto');
    expect(
      pluginDiagnosticCollectionRequestV1Schema.safeParse({
        apiVersion:
          'diagnostic-collection-request.plugin.enterpriseglue.io/v1',
        ...common,
        engineRef: 'engine-1',
        trigger: { kind: 'engine' },
        profile: 'engine_health',
        mode: 'manual',
        idempotencyKey: 'diagnostic-intent-1',
        rawLogPath: '/var/log/engine.log',
      }).success,
    ).toBe(false);
  });

  it('exposes only class-level collector health without deployment selectors', () => {
    expect(
      pluginDiagnosticCollectorStatusResponseV1Schema.parse({
        apiVersion:
          'diagnostic-collector-status.plugin.enterpriseglue.io/v1',
        state: 'ready',
        reasonCode: 'collector_ready',
        collectionPermission: 'granted',
        sourceClass: 'multiple',
        filteringBoundary: 'enterpriseglue_backend',
        rawUploadPermitted: false,
        browserEditable: false,
        checkedAt: '2026-07-26T00:00:00.000Z',
      }),
    ).not.toHaveProperty('sourcePath');
    expect(
      pluginDiagnosticCollectorStatusRequestV1Schema.safeParse({
        apiVersion:
          'diagnostic-collector-status-request.plugin.enterpriseglue.io/v1',
        ...common,
        engineRef: 'caller-selected-engine',
        sourceId: 'caller-selected-source',
        path: '/var/log/customer.log',
      }).success,
    ).toBe(false);
  });

  it('allows only host-rendered notification templates and safe references', () => {
    expect(
      pluginNotificationPublishRequestV1Schema.parse({
        apiVersion:
          'notification-publish-request.plugin.enterpriseglue.io/v1',
        ...common,
        templateId: 'host.plugin.action-required.v1',
        reasonCode: 'analysis_needs_attention',
        resource: { kind: 'incident', ref: 'incident-1' },
        occurrenceCount: 3,
        idempotencyKey: 'notification-1',
      }).templateId,
    ).toBe('host.plugin.action-required.v1');
    expect(
      pluginNotificationPublishRequestV1Schema.safeParse({
        apiVersion:
          'notification-publish-request.plugin.enterpriseglue.io/v1',
        ...common,
        templateId: 'host.plugin.action-required.v1',
        reasonCode: 'analysis_needs_attention',
        idempotencyKey: 'notification-1',
        title: 'Plugin-controlled content',
        targetUserRef: 'another-user',
      }).success,
    ).toBe(false);
  });

  it('allows fixed intervals but makes cron and executable jobs impossible', () => {
    expect(
      pluginFixedScheduleRequestV1Schema.parse({
        apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
        ...common,
        action: 'upsert',
        jobType: 'io.enterpriseglue.example.refresh-index',
        intervalSeconds: 3600,
        idempotencyKey: 'schedule-1',
      }).intervalSeconds,
    ).toBe(3600);
    expect(
      pluginFixedScheduleRequestV1Schema.safeParse({
        apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
        ...common,
        action: 'upsert',
        jobType: 'io.enterpriseglue.example.refresh-index',
        intervalSeconds: 3600,
        cron: '* * * * *',
        command: 'curl attacker.invalid',
        idempotencyKey: 'schedule-1',
      }).success,
    ).toBe(false);
  });

  it('binds a sanitized diagnostic handoff without exposing a source path', () => {
    const keys = generateKeyPairSync('ed25519');
    const unsigned = {
      apiVersion:
        'sanitized-diagnostic-bundle.plugin.enterpriseglue.io/v1' as const,
      bundleRef: 'diagnostic-bundle-1',
      pluginId: 'io.enterpriseglue.example',
      deploymentRef: 'deployment-1',
      tenantRef: 'tenant-1',
      engineRef: 'engine-1',
      consumerContextRef: 'case-1',
      trigger: { kind: 'incident' as const, incidentRef: 'incident-1' },
      profile: 'incident_minimal' as const,
      sourceId: 'io.enterpriseglue.source.engine-log',
      policyRevision: 'policy-1',
      collectedAt: '2026-07-25T00:00:00.000Z',
      expiresAt: '2026-07-25T00:05:00.000Z',
      nonce: 'nonce-0123456789',
      contentType: 'text/plain; charset=utf-8' as const,
      contentSha256: 'a'.repeat(64),
      contentBytes: 22,
      lineCount: 1,
      redactionSummary: {
        secrets: 1,
        emails: 0,
        networkAddresses: 0,
        identifiers: 0,
      },
      filteringBoundary: 'enterpriseglue_backend' as const,
      sanitizedContent: 'password=<SECRET>',
      signingKeyId: 'collector-key-1',
      signatureAlgorithm: 'Ed25519' as const,
    };
    const signature = sign(
      null,
      Buffer.from(pluginDiagnosticBundleSignaturePayloadV1(unsigned)),
      keys.privateKey,
    ).toString('base64');
    expect(
      pluginSanitizedDiagnosticBundleV1Schema.parse({
        ...unsigned,
        signature,
      }).sanitizedContent,
    ).not.toContain('customer-secret');
    expect(
      verify(
        null,
        Buffer.from(pluginDiagnosticBundleSignaturePayloadV1(unsigned)),
        keys.publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    const { consumerContextRef: _context, ...legacyUnsigned } = unsigned;
    expect(
      pluginDiagnosticBundleSignaturePayloadV1(legacyUnsigned),
    ).toBe(
      JSON.stringify([
        legacyUnsigned.apiVersion,
        legacyUnsigned.bundleRef,
        legacyUnsigned.pluginId,
        legacyUnsigned.deploymentRef,
        legacyUnsigned.tenantRef,
        legacyUnsigned.engineRef,
        legacyUnsigned.trigger,
        legacyUnsigned.profile,
        legacyUnsigned.sourceId,
        legacyUnsigned.policyRevision,
        legacyUnsigned.collectedAt,
        legacyUnsigned.expiresAt,
        legacyUnsigned.nonce,
        legacyUnsigned.contentType,
        legacyUnsigned.contentSha256,
        legacyUnsigned.contentBytes,
        legacyUnsigned.lineCount,
        legacyUnsigned.redactionSummary,
        legacyUnsigned.filteringBoundary,
        legacyUnsigned.signingKeyId,
        legacyUnsigned.signatureAlgorithm,
      ]),
    );
    expect(
      pluginSanitizedDiagnosticBundleV1Schema.safeParse({
        ...unsigned,
        signature,
        sourcePath: '/var/log/customer-engine.log',
      }).success,
    ).toBe(false);
  });
});
