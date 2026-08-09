import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'external_engine_registrations', schema: 'main' })
@Unique('uq_external_engine_registrations_engine', ['engineId'])
@Unique('uq_external_engine_registrations_source_identity', ['sourceIdentity'])
@Unique('uq_external_engine_registrations_active_external_identity', ['activeExternalIdIdentity'])
@Index('idx_external_engine_registrations_engine', ['engineId'])
@Index('idx_external_engine_registrations_external_id', ['externalId'])
@Index('idx_external_engine_registrations_api_client', ['apiClientId'])
@Index('idx_external_engine_registrations_system', ['externalSystemId'])
@Index('idx_external_engine_registrations_lifecycle_status', ['lifecycleStatus'])
@Index('idx_external_engine_registrations_capability_status', ['capabilityStatus'])
export class ExternalEngineRegistration extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'external_id', type: 'text' })
  externalId!: string;

  /** Stable idempotency key for the owning source plus external engine id. */
  @Column({ name: 'source_identity', type: 'text' })
  sourceIdentity!: string;

  /** Global active external-id claim. Replaced with a unique tombstone on decommission. */
  @Column({ name: 'active_external_id_identity', type: 'text' })
  activeExternalIdIdentity!: string;

  @Column({ name: 'labels_json', type: 'text', nullable: true })
  labelsJson!: string | null;

  @Column({ name: 'registration_source', type: 'text' })
  registrationSource!: string;

  @Column({ name: 'api_client_id', type: 'text', nullable: true })
  apiClientId!: string | null;

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

  @Column({ name: 'last_registered_at', type: 'bigint', nullable: true })
  lastRegisteredAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
