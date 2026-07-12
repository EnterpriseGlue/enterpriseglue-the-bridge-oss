import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'external_engine_systems', schema: 'main' })
@Unique('uq_external_engine_systems_tenant_key', ['tenantId', 'key'])
@Index('idx_external_engine_systems_tenant', ['tenantId'])
@Index('idx_external_engine_systems_active', ['isActive'])
export class ExternalEngineSystem extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'default_management_mode', type: 'text', default: 'external_managed' })
  defaultManagementMode!: string;

  @Column({ name: 'default_field_ownership_json', type: 'text', nullable: true })
  defaultFieldOwnershipJson!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
