import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * Source-owned link between an EnterpriseGlue authorization group and the
 * native engine group used by a mirrored authorization backstop. Native
 * identifiers are encrypted; ordinary read APIs use nativeGroupReference.
 */
@Entity({ name: 'engine_backstop_group_mappings', schema: 'main' })
@Unique('uq_engine_backstop_group_mapping_group', ['engineId', 'authzGroupId'])
@Unique('uq_engine_backstop_group_mapping_native_group', ['engineId', 'nativeGroupReference'])
@Unique('uq_engine_backstop_group_mapping_source', ['engineId', 'source', 'sourceRef'])
@Index('idx_engine_backstop_group_mapping_engine_active', ['engineId', 'isActive'])
@Index('idx_engine_backstop_group_mapping_tenant', ['tenantId'])
export class EngineBackstopGroupMapping extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ name: 'authz_group_id', type: 'text' }) authzGroupId!: string;
  @Column({ name: 'encrypted_native_group_id', type: 'text' }) encryptedNativeGroupId!: string;
  @Column({ name: 'native_group_reference', type: 'text' }) nativeGroupReference!: string;
  @Column({ type: 'text', default: 'manual' }) source!: string;
  @Column({ name: 'source_ref', type: 'text' }) sourceRef!: string;
  /** Opaque configuration secret reference; never the decrypted native group id. */
  @Column({ name: 'native_group_secret_ref', type: 'text', nullable: true }) nativeGroupSecretRef!: string | null;
  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' }) ownershipMode!: string;
  @Column({ name: 'source_hash', type: 'text', nullable: true }) sourceHash!: string | null;
  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true }) lastAppliedAt!: number | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @Column({ name: 'created_by_id', type: 'text', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
