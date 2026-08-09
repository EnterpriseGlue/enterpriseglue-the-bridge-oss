import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'runtime_resource_set_materializations', schema: 'main' })
@Unique('uq_runtime_resource_set_materializations_member', ['runtimeResourceSetId', 'runtimeResourceId'])
@Index('idx_runtime_resource_set_materializations_set', ['runtimeResourceSetId'])
@Index('idx_runtime_resource_set_materializations_resource', ['runtimeResourceId'])
export class RuntimeResourceSetMaterialization extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'runtime_resource_set_id', type: 'text' }) runtimeResourceSetId!: string;
  @Column({ name: 'runtime_resource_id', type: 'text' }) runtimeResourceId!: string;
  @Column({ name: 'selector_fingerprint', type: 'text' }) selectorFingerprint!: string;
  @Column({ name: 'matched_by_json', type: 'text' }) matchedByJson!: string;
  @Column({ name: 'lineage_json', type: 'text' }) lineageJson!: string;
  @Column({ name: 'last_seen_at', type: 'bigint' }) lastSeenAt!: number;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
