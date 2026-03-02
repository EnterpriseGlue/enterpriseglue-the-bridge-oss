import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'authz_audit_log', schema: 'main' })
@Index('idx_authz_audit_log_user', ['userId', 'timestamp'])
@Index('idx_authz_audit_log_resource', ['resourceType', 'resourceId', 'timestamp'])
@Index('idx_authz_audit_log_decision', ['decision', 'timestamp'])
export class AuthzAuditLog extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  action!: string;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'text' })
  decision!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'policy_id', type: 'text', nullable: true })
  policyId!: string | null;

  @Column({ type: 'text', default: '{}' })
  context!: string;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'bigint' })
  timestamp!: number;
}
