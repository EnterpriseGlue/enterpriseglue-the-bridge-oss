import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'project_engine_targets', schema: 'main' })
@Unique('uq_project_engine_targets_pair', ['projectId', 'engineId'])
@Index('idx_project_engine_targets_tenant', ['tenantId'])
@Index('idx_project_engine_targets_project', ['projectId'])
@Index('idx_project_engine_targets_engine', ['engineId'])
@Index('idx_project_engine_targets_status', ['status'])
@Index('idx_project_engine_targets_source', ['source', 'sourceRef'])
@Index('idx_project_engine_targets_external', ['externalSystemId', 'externalTargetId'])
export class ProjectEngineTarget extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ type: 'text', default: 'active' })
  status!: string;

  @Column({ type: 'text', default: 'manual' })
  source!: string;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' })
  ownershipMode!: string;

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: string | null;

  @Column({ name: 'external_system_id', type: 'text', nullable: true })
  externalSystemId!: string | null;

  @Column({ name: 'external_project_id', type: 'text', nullable: true })
  externalProjectId!: string | null;

  @Column({ name: 'external_engine_id', type: 'text', nullable: true })
  externalEngineId!: string | null;

  @Column({ name: 'external_target_id', type: 'text', nullable: true })
  externalTargetId!: string | null;

  @Column({ name: 'allow_manual_deploy', type: 'boolean', default: true })
  allowManualDeploy!: boolean;

  @Column({ name: 'allow_ci_deploy', type: 'boolean', default: false })
  allowCiDeploy!: boolean;

  @Column({ name: 'allow_api_deploy', type: 'boolean', default: false })
  allowApiDeploy!: boolean;

  @Column({ name: 'allow_import', type: 'boolean', default: true })
  allowImport!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'approved_by_id', type: 'text', nullable: true })
  approvedById!: string | null;

  @Column({ name: 'approval_status', type: 'text', default: 'not_required' })
  approvalStatus!: string;

  @Column({ name: 'approved_at', type: 'bigint', nullable: true })
  approvedAt!: number | null;

  @Column({ name: 'policy_tags_json', type: 'text', nullable: true })
  policyTagsJson!: string | null;

  @Column({ name: 'diagnostics_json', type: 'text', nullable: true })
  diagnosticsJson!: string | null;

  @Column({ name: 'last_seen_at', type: 'bigint', nullable: true })
  lastSeenAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
