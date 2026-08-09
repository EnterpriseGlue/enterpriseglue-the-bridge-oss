import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_sync_runs', schema: 'main' })
@Index('idx_sso_sync_runs_tenant', ['tenantId', 'startedAt'])
@Index('idx_sso_sync_runs_provider', ['providerId', 'startedAt'])
@Index('idx_sso_sync_runs_status', ['status', 'startedAt'])
@Index('idx_sso_sync_runs_user', ['userId', 'startedAt'])
export class SsoSyncRun extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ type: 'text' })
  trigger!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'started_at', type: 'bigint' })
  startedAt!: number;

  @Column({ name: 'completed_at', type: 'bigint', nullable: true })
  completedAt!: number | null;

  @Column({ name: 'group_memberships_created', type: 'integer', default: 0 })
  groupMembershipsCreated!: number;

  @Column({ name: 'group_memberships_updated', type: 'integer', default: 0 })
  groupMembershipsUpdated!: number;

  @Column({ name: 'group_memberships_removed', type: 'integer', default: 0 })
  groupMembershipsRemoved!: number;

  @Column({ name: 'assignments_created', type: 'integer', default: 0 })
  assignmentsCreated!: number;

  @Column({ name: 'assignments_updated', type: 'integer', default: 0 })
  assignmentsUpdated!: number;

  @Column({ name: 'assignments_removed', type: 'integer', default: 0 })
  assignmentsRemoved!: number;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'text', default: '{}' })
  details!: string;
}
