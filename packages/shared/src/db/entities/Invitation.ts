import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type InvitationResourceType = 'platform_user' | 'tenant' | 'project' | 'engine';
export type InvitationDeliveryMethod = 'email' | 'manual';
export type InvitationStatus = 'pending' | 'otp_verified' | 'completed' | 'revoked';

@Entity({ name: 'invitations', schema: 'main' })
@Index('idx_invitations_user', ['userId'])
@Index('idx_invitations_email', ['email'])
@Index('idx_invitations_token_hash', ['inviteTokenHash'], { unique: true })
export class Invitation extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'email', type: 'text' })
  email!: string;

  @Column({ name: 'tenant_slug', type: 'text' })
  tenantSlug!: string;

  @Column({ name: 'resource_type', type: 'text' })
  resourceType!: InvitationResourceType;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'resource_name', type: 'text', nullable: true })
  resourceName!: string | null;

  @Column({ name: 'platform_role', type: 'text', nullable: true })
  platformRole!: string | null;

  @Column({ name: 'resource_role', type: 'text', nullable: true })
  resourceRole!: string | null;

  @Column({ name: 'resource_roles_json', type: 'text', nullable: true })
  resourceRolesJson!: string | null;

  @Column({ name: 'invite_token_hash', type: 'text', unique: true })
  inviteTokenHash!: string;

  @Column({ name: 'one_time_password_hash', type: 'text' })
  oneTimePasswordHash!: string;

  @Column({ name: 'delivery_method', type: 'text' })
  deliveryMethod!: InvitationDeliveryMethod;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: InvitationStatus;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'created_by_user_id', type: 'text', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'otp_verified_at', type: 'bigint', nullable: true })
  otpVerifiedAt!: number | null;

  @Column({ name: 'completed_at', type: 'bigint', nullable: true })
  completedAt!: number | null;

  @Column({ name: 'revoked_at', type: 'bigint', nullable: true })
  revokedAt!: number | null;

  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts!: number;

  @Column({ name: 'locked_until', type: 'bigint', nullable: true })
  lockedUntil!: number | null;
}
