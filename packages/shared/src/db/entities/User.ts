import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'users', schema: 'main' })
@Index('idx_users_email', ['email'], { unique: true })
export class User extends AppBaseEntity {
  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ name: 'auth_provider', type: 'text', default: 'local' })
  authProvider!: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'entra_id', type: 'text', nullable: true, unique: true })
  entraId!: string | null;

  @Column({ name: 'entra_email', type: 'text', nullable: true })
  entraEmail!: string | null;

  @Column({ name: 'google_id', type: 'text', nullable: true, unique: true })
  googleId!: string | null;

  @Column({ name: 'first_name', type: 'text', nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'text', nullable: true })
  lastName!: string | null;

  @Column({ name: 'platform_role', type: 'text', default: 'user' })
  platformRole!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'must_reset_password', type: 'boolean', default: false })
  mustResetPassword!: boolean;

  @Column({ name: 'failed_login_attempts', type: 'bigint', default: 0 })
  failedLoginAttempts!: number;

  @Column({ name: 'locked_until', type: 'bigint', nullable: true })
  lockedUntil!: number | null;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified!: boolean;

  @Column({ name: 'email_verification_token', type: 'text', nullable: true })
  emailVerificationToken!: string | null;

  @Column({ name: 'email_verification_token_expiry', type: 'bigint', nullable: true })
  emailVerificationTokenExpiry!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'last_login_at', type: 'bigint', nullable: true })
  lastLoginAt!: number | null;

  @Column({ name: 'created_by_user_id', type: 'text', nullable: true })
  createdByUserId!: string | null;
}
