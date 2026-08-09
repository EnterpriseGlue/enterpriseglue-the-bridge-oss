import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_sync_events', schema: 'main' })
@Index('idx_sso_sync_events_run', ['runId', 'createdAt'])
@Index('idx_sso_sync_events_tenant', ['tenantId', 'createdAt'])
@Index('idx_sso_sync_events_provider', ['providerId', 'createdAt'])
@Index('idx_sso_sync_events_severity', ['severity', 'createdAt'])
@Index('idx_sso_sync_events_mapping', ['mappingType', 'mappingId'])
export class SsoSyncEvent extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'run_id', type: 'text' })
  runId!: string;

  @Column({ type: 'text' })
  severity!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ name: 'mapping_type', type: 'text', nullable: true })
  mappingType!: string | null;

  @Column({ name: 'mapping_id', type: 'text', nullable: true })
  mappingId!: string | null;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text', default: '{}' })
  details!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
