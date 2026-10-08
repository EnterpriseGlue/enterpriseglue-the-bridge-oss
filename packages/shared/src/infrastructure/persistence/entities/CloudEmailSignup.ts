import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Unauthenticated, expiring address proof; never an application user or tenant member. */
@Entity({ name: 'cloud_email_signups', schema: 'main' })
@Index('uq_cloud_email_signups_email_hash', ['emailHash'], { unique: true })
@Index('uq_cloud_email_signups_token', ['tokenHash'], { unique: true })
@Index('idx_cloud_email_signups_expires', ['expiresAt'])
export class CloudEmailSignup extends AppBaseEntity {
  @Column({ type: 'text' }) email!: string;
  @Column({ name: 'email_hash', type: 'text' }) emailHash!: string;
  @Column({ name: 'token_hash', type: 'text' }) tokenHash!: string;
  @Column({ name: 'expires_at', type: 'bigint' }) expiresAt!: number;
  @Column({ name: 'challenge', type: 'text', nullable: true }) challenge!: string | null;
  @Column({ name: 'challenge_expires_at', type: 'bigint', nullable: true }) challengeExpiresAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
