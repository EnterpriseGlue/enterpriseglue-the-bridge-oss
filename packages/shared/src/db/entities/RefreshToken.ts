import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'refresh_tokens', schema: 'main' })
@Index('idx_refresh_tokens_user', ['userId'])
export class RefreshToken extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'revoked_at', type: 'bigint', nullable: true })
  revokedAt!: number | null;

  @Column({ name: 'device_info', type: 'text', nullable: true })
  deviceInfo!: string | null;
}
