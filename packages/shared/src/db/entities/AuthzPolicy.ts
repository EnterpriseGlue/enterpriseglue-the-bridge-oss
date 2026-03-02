import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'authz_policies', schema: 'main' })
@Index('idx_authz_policies_eval', ['resourceType', 'action', 'isActive', 'priority'])
export class AuthzPolicy extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', default: 'allow' })
  effect!: string;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ type: 'text', nullable: true })
  action!: string | null;

  @Column({ type: 'text', default: '{}' })
  conditions!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;
}
