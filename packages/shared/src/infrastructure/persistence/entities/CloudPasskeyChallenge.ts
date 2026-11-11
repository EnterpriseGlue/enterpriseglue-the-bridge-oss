import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Single-use browser-bound passkey assertion challenge. */
@Entity({ name: 'cloud_passkey_challenges', schema: 'main' })
@Index('uq_cloud_passkey_challenges_token', ['tokenHash'], { unique: true })
@Index('idx_cloud_passkey_challenges_expires', ['expiresAt'])
export class CloudPasskeyChallenge extends AppBaseEntity {
  @Column({ name: 'token_hash', type: 'text' }) tokenHash!: string;
  @Column({ type: 'text' }) challenge!: string;
  @Column({ name: 'expires_at', type: 'bigint' }) expiresAt!: number;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
}
