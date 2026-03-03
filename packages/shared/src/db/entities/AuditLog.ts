import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'audit_logs', schema: 'main' })
@Index('idx_audit_logs_user', ['userId'])
@Index('idx_audit_logs_tenant', ['tenantId'])
@Index('idx_audit_logs_action', ['action'])
@Index('idx_audit_logs_created', ['createdAt'])
export class AuditLog extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
