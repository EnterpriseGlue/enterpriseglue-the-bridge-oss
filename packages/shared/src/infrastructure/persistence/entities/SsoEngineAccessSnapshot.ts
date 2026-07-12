import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_engine_access_snapshots', schema: 'main' })
@Index('idx_sso_engine_access_snapshots_engine', ['engineId', 'status'])
@Index('idx_sso_engine_access_snapshots_principal', ['principalType', 'principalId'])
@Index('idx_sso_engine_access_snapshots_mapping', ['mappingId'])
@Index('idx_sso_engine_access_snapshots_provider', ['providerId'])
@Index('idx_sso_engine_access_snapshots_status', ['status'])
@Index('idx_sso_engine_access_snapshots_sync', ['lastSyncedAt'])
export class SsoEngineAccessSnapshot extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'mapping_id', type: 'text' })
  mappingId!: string;

  @Column({ name: 'principal_type', type: 'text' })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'text' })
  principalId!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'provider_subject_ids_json', type: 'text', default: '[]' })
  providerSubjectIdsJson!: string;

  @Column({ name: 'provider_group_ids_json', type: 'text', default: '[]' })
  providerGroupIdsJson!: string;

  @Column({ name: 'provider_app_role_ids_json', type: 'text', default: '[]' })
  providerAppRoleIdsJson!: string;

  @Column({ name: 'current_role_ids_json', type: 'text', default: '[]' })
  currentRoleIdsJson!: string;

  @Column({ name: 'previous_role_ids_json', type: 'text', default: '[]' })
  previousRoleIdsJson!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'cleanup_reason', type: 'text', nullable: true })
  cleanupReason!: string | null;

  @Column({ name: 'last_seen_at', type: 'bigint' })
  lastSeenAt!: number;

  @Column({ name: 'last_synced_at', type: 'bigint' })
  lastSyncedAt!: number;

  @Column({ name: 'removed_at', type: 'bigint', nullable: true })
  removedAt!: number | null;

  @Column({ type: 'text', default: '{}' })
  details!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
