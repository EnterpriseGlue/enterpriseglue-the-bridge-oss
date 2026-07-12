import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'roles', schema: 'main' })
@Index('idx_roles_tenant', ['tenantId'])
@Index('idx_roles_scope', ['scope'])
@Index('idx_roles_kind', ['kind'])
export class RbacRole extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text', unique: true })
  key!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ name: 'is_editable', type: 'boolean', default: false })
  isEditable!: boolean;

  @Column({ name: 'is_assignable', type: 'boolean', default: true })
  isAssignable!: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
