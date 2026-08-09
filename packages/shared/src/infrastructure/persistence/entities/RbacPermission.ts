import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'permissions', schema: 'main' })
@Index('idx_permissions_scope', ['scope'])
@Index('idx_permissions_category', ['category'])
export class RbacPermission extends AppBaseEntity {
  @Column({ type: 'text', unique: true })
  key!: string;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ type: 'text' })
  category!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', default: 'system' })
  kind!: string;

  @Column({ name: 'is_editable', type: 'boolean', default: false })
  isEditable!: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
