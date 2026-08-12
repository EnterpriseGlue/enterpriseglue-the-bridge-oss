import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export type AdminConfigObjectType =
  | 'git_provider'
  | 'email_configuration'
  | 'email_template'
  | 'permission'
  | 'authorization_policy'
  | 'api_client'
  | 'service_account'
  | 'external_engine_system';

/** Durable provenance for admin catalog rows that predate configuration-as-code. */
@Entity({ name: 'admin_config_object_ownership', schema: 'main' })
@Unique('uq_admin_config_object_ownership_object', ['objectType', 'objectId'])
@Unique('uq_admin_config_object_ownership_key_identity', ['keyIdentity'])
@Index('idx_admin_config_object_ownership_source', ['sourceRef', 'objectType'])
export class AdminConfigObjectOwnership {
  @PrimaryColumn({ type: 'text' }) id!: string;
  @Column({ name: 'object_type', type: 'text' }) objectType!: AdminConfigObjectType;
  @Column({ name: 'object_id', type: 'text' }) objectId!: string;
  @Column({ name: 'scope_key', type: 'text' }) scopeKey!: string;
  @Column({ name: 'config_key', type: 'text' }) configKey!: string;
  @Column({ name: 'key_identity', type: 'text' }) keyIdentity!: string;
  @Column({ name: 'source_ref', type: 'text' }) sourceRef!: string;
  @Column({ name: 'ownership_mode', type: 'text', default: 'config_locked' }) ownershipMode!: 'config_locked' | 'config_warn' | 'manual';
  @Column({ name: 'source_hash', type: 'text' }) sourceHash!: string;
  /** Safe external references only; never resolved secret bytes. */
  @Column({ name: 'secret_references_json', type: 'text', nullable: true }) secretReferencesJson!: string | null;
  @Column({ name: 'last_applied_at', type: 'bigint' }) lastAppliedAt!: number;
  @Column({ name: 'drift_status', type: 'text', default: 'in_sync' }) driftStatus!: 'in_sync' | 'drifted';
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ type: 'bigint', default: 0 }) generation!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
