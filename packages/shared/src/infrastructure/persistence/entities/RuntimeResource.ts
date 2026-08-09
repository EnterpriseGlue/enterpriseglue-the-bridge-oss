import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * A sanitized, EnterpriseGlue-owned observation of a process or decision
 * definition. It is an authorization inventory, not a copy of engine data.
 */
@Entity({ name: 'runtime_resources', schema: 'main' })
@Unique('uq_runtime_resources_identity', ['engineId', 'resourceKind', 'resourceKey', 'runtimeTenantId'])
@Index('idx_runtime_resources_engine_kind', ['engineId', 'resourceKind'])
@Index('idx_runtime_resources_project', ['projectId'])
@Index('idx_runtime_resources_active', ['engineId', 'isActive'])
@Index('idx_runtime_resources_tenant_resolution', ['engineId', 'tenantResolutionStatus'])
export class RuntimeResource extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'tenant_resolution_status', type: 'text', default: 'unmapped' }) tenantResolutionStatus!: string;
  @Column({ name: 'tenant_mapping_id', type: 'text', nullable: true }) tenantMappingId!: string | null;
  @Column({ name: 'tenant_mapping_version', type: 'integer', default: 0 }) tenantMappingVersion!: number;
  @Column({ name: 'tenant_resolution_details_json', type: 'text', default: '{}' }) tenantResolutionDetailsJson!: string;
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ name: 'resource_kind', type: 'text' }) resourceKind!: string;
  @Column({ name: 'resource_key', type: 'text' }) resourceKey!: string;
  // Empty string is the canonical persisted representation for no runtime tenant.
  @Column({ name: 'runtime_tenant_id', type: 'text', default: '' }) runtimeTenantId!: string;
  @Column({ name: 'engine_resource_id', type: 'text', nullable: true }) engineResourceId!: string | null;
  @Column({ name: 'deployment_id', type: 'text', nullable: true }) deploymentId!: string | null;
  @Column({ name: 'project_id', type: 'text', nullable: true }) projectId!: string | null;
  @Column({ name: 'file_id', type: 'text', nullable: true }) fileId!: string | null;
  @Column({ type: 'integer', nullable: true }) version!: number | null;
  @Column({ name: 'labels_json', type: 'text', default: '{}' }) labelsJson!: string;
  @Column({ name: 'lineage_json', type: 'text', default: '{}' }) lineageJson!: string;
  @Column({ type: 'text', default: 'engine_discovery' }) source!: string;
  @Column({ name: 'source_ref', type: 'text', nullable: true }) sourceRef!: string | null;
  @Column({ name: 'observed_at', type: 'bigint' }) observedAt!: number;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
