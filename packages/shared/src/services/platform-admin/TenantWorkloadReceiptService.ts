import { createPrivateKey, sign as signPayload } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { canonicalizeConfigJson } from './config-bundle-hash.js';
import type { TenantLifecycleCommand } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';

export const TENANT_WORKLOAD_RECEIPT_V1_SCHEMA = 'tenant-workload-receipt.enterpriseglue.io/v1' as const;

export interface TenantWorkloadReceiptPayloadV1 {
  schemaVersion: typeof TENANT_WORKLOAD_RECEIPT_V1_SCHEMA;
  issuer: string;
  audience: string;
  operationId: string;
  command: TenantLifecycleCommand;
  actorId: string;
  tenantId: string;
  tenantSlug: string;
  tenantStatus: string;
  placementEpoch: number;
  routingAliases: string[];
  correlationId: string;
  requestHash: string;
  idempotencyKeyHash: string;
  issuedAt: number;
}

export interface SignedTenantWorkloadReceiptV1 {
  payload: TenantWorkloadReceiptPayloadV1;
  signature: {
    algorithm: 'ES256';
    keyId: string;
    value: string;
  };
  idempotent: boolean;
}

export class TenantWorkloadReceiptService {
  sign(payload: TenantWorkloadReceiptPayloadV1): SignedTenantWorkloadReceiptV1 {
    const privateKeyPem = config.tenantWorkloadReceiptPrivateKey;
    const keyId = config.tenantWorkloadReceiptKeyId;
    if (!privateKeyPem || !keyId || !config.tenantWorkloadReceiptIssuer || !config.tenantPlacementV2Audience) {
      throw Errors.serviceUnavailable('Tenant workload receipt signing');
    }
    let privateKey;
    try {
      privateKey = createPrivateKey(privateKeyPem);
    } catch {
      throw Errors.serviceUnavailable('Tenant workload receipt signing key');
    }
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw Errors.serviceUnavailable('Tenant workload ES256 receipt signing');
    }
    const signature = signPayload(
      'sha256',
      Buffer.from(canonicalizeConfigJson(payload), 'utf8'),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    );
    return {
      payload,
      signature: { algorithm: 'ES256', keyId, value: signature.toString('base64url') },
      idempotent: false,
    };
  }
}

export const tenantWorkloadReceiptService = new TenantWorkloadReceiptService();
