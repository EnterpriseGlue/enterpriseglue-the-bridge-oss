import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engines', schema: 'main' })
@Index('idx_engines_owner', ['ownerId'])
@Index('idx_engines_delegate', ['delegateId'])
@Index('idx_engines_environment', ['environmentTagId'])
@Index('idx_engines_tenant', ['tenantId'])
@Index('idx_engines_external_id', ['externalId'])
@Index('idx_engines_external_system', ['externalSystemId'])
@Index('idx_engines_lifecycle_status', ['lifecycleStatus'])
@Index('idx_engines_capability_status', ['capabilityStatus'])
@Index('idx_engines_source_ref', ['sourceRef'])
@Index('idx_engines_tenancy_mode', ['tenancyMode'])
@Index('idx_engines_tenant_resolution_status', ['tenantResolutionStatus'])
@Index('uq_engines_config_key_identity', ['configKeyIdentity'], { unique: true })
export class Engine extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ name: 'auth_type', type: 'text', nullable: true })
  authType!: string | null;

  @Column({ type: 'text', nullable: true })
  username!: string | null;

  @Column({ name: 'password_enc', type: 'text', nullable: true })
  passwordEnc!: string | null;

  @Column({ name: 'oauth_token_url', type: 'text', nullable: true })
  oauthTokenUrl!: string | null;

  @Column({ name: 'oauth_scopes', type: 'text', nullable: true })
  oauthScopes!: string | null;

  @Column({ name: 'oauth_audience', type: 'text', nullable: true })
  oauthAudience!: string | null;

  @Column({ type: 'text', nullable: true })
  version!: string | null;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ name: 'labels_json', type: 'text', nullable: true })
  labelsJson!: string | null;

  @Column({ name: 'registration_source', type: 'text', nullable: true })
  registrationSource!: string | null;

  /** Owning registration/configuration source, separate from display metadata. */
  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  /** Stable key used by JSON configuration references. */
  @Column({ name: 'config_key', type: 'text', nullable: true })
  configKey!: string | null;

  /** Tenant-scoped uniqueness key for config-managed engine keys. */
  @Column({ name: 'config_key_identity', type: 'text', nullable: true })
  configKeyIdentity!: string | null;

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'ownership_mode', type: 'text', nullable: true })
  ownershipMode!: string | null;

  @Column({ name: 'external_system_id', type: 'text', nullable: true })
  externalSystemId!: string | null;

  @Column({ name: 'management_mode', type: 'text', nullable: true })
  managementMode!: string | null;

  @Column({ name: 'field_ownership_json', type: 'text', nullable: true })
  fieldOwnershipJson!: string | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: string | null;

  @Column({ name: 'lifecycle_status', type: 'text', nullable: true })
  lifecycleStatus!: string | null;

  @Column({ name: 'last_external_sync_at', type: 'bigint', nullable: true })
  lastExternalSyncAt!: number | null;

  @Column({ name: 'capabilities_json', type: 'text', nullable: true })
  capabilitiesJson!: string | null;

  @Column({ name: 'capability_status', type: 'text', nullable: true })
  capabilityStatus!: string | null;

  /** Distributed engines remain engine-wide; central engines opt into resource-aware filtering. */
  @Column({ name: 'runtime_access_scope', type: 'text', default: 'engine_wide' })
  runtimeAccessScope!: string;

  /** Dedicated engines have one tenant; shared engines require explicit resource mappings. */
  @Column({ name: 'tenancy_mode', type: 'text', default: 'dedicated' })
  tenancyMode!: string;

  @Column({ name: 'tenant_mapping_strategy', type: 'text', nullable: true })
  tenantMappingStrategy!: string | null;

  @Column({ name: 'tenant_mapping_version', type: 'integer', default: 0 })
  tenantMappingVersion!: number;

  @Column({ name: 'tenant_resolution_status', type: 'text', default: 'migration_required' })
  tenantResolutionStatus!: string;

  @Column({ name: 'last_tenant_reconciled_at', type: 'bigint', nullable: true })
  lastTenantReconciledAt!: number | null;

  @Column({ name: 'deployment_integration', type: 'text', default: 'enterpriseglue_proxy' })
  deploymentIntegration!: string;

  /** Allows an engine to opt out of scheduled metadata discovery. */
  @Column({ name: 'metadata_discovery_enabled', type: 'boolean', default: true })
  metadataDiscoveryEnabled!: boolean;

  /** Controls ingestion of engine-observed deployment history independently of runtime definitions. */
  @Column({ name: 'deployment_discovery_enabled', type: 'boolean', default: true })
  deploymentDiscoveryEnabled!: boolean;

  @Column({ name: 'reconciliation_interval_seconds', type: 'integer', default: 300 })
  reconciliationIntervalSeconds!: number;

  @Column({ name: 'last_metadata_reconciled_at', type: 'bigint', nullable: true })
  lastMetadataReconciledAt!: number | null;

  @Column({ name: 'last_metadata_reconciliation_status', type: 'text', nullable: true })
  lastMetadataReconciliationStatus!: string | null;

  @Column({ name: 'pipeline_receipt_enabled', type: 'boolean', default: true })
  pipelineReceiptEnabled!: boolean;

  /** Direct connection or a customer-managed sidecar/gateway endpoint. */
  @Column({ name: 'connection_mode', type: 'text', default: 'direct' })
  connectionMode!: string;

  @Column({ name: 'external_updated_at', type: 'bigint', nullable: true })
  externalUpdatedAt!: number | null;

  @Column({ name: 'owner_id', type: 'text', nullable: true })
  ownerId!: string | null;

  @Column({ name: 'delegate_id', type: 'text', nullable: true })
  delegateId!: string | null;

  @Column({ name: 'environment_tag_id', type: 'text', nullable: true })
  environmentTagId!: string | null;

  @Column({ name: 'environment_locked', type: 'boolean', default: false })
  environmentLocked!: boolean;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
