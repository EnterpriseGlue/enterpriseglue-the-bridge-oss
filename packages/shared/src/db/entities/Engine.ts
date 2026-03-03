import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engines', schema: 'main' })
@Index('idx_engines_owner', ['ownerId'])
@Index('idx_engines_delegate', ['delegateId'])
@Index('idx_engines_environment', ['environmentTagId'])
@Index('idx_engines_tenant', ['tenantId'])
export class Engine extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ name: 'auth_type', type: 'text', nullable: true })
  authType!: string | null;

  @Column({ type: 'text', nullable: true })
  username!: string | null;

  @Column({ name: 'password_enc', type: 'text', nullable: true })
  passwordEnc!: string | null;

  @Column({ type: 'text', nullable: true })
  version!: string | null;

  @Column({ name: 'owner_id', type: 'text', nullable: true })
  ownerId!: string | null;

  @Column({ name: 'delegate_id', type: 'text', nullable: true })
  delegateId!: string | null;

  @Column({ name: 'environment_tag_id', type: 'text', nullable: true })
  environmentTagId!: string | null;

  @Column({ name: 'environment_locked', type: 'boolean', default: false })
  environmentLocked!: boolean;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
