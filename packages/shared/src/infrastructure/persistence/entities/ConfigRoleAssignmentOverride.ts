import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Durable local override for a config-owned assignment removed in warning mode. */
@Entity({ name: 'config_role_assignment_overrides', schema: 'main' })
@Unique('uq_config_role_assignment_override', ['assignmentKey', 'sourceRef'])
@Index('idx_config_role_assignment_override_source', ['sourceRef'])
export class ConfigRoleAssignmentOverride extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'assignment_key', type: 'text' }) assignmentKey!: string;
  @Column({ name: 'source_ref', type: 'text' }) sourceRef!: string;
  @Column({ name: 'removed_assignment_id', type: 'text' }) removedAssignmentId!: string;
  @Column({ name: 'removed_by_id', type: 'text', nullable: true }) removedById!: string | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
