import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'password_reset_tokens', schema: 'main' })
@Index('idx_password_reset_tokens_user', ['userId'])
@Index('idx_password_reset_tokens_hash', ['tokenHash'], { unique: true })
export class PasswordResetToken extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'consumed_at', type: 'bigint', nullable: true })
  consumedAt!: number | null;
}
