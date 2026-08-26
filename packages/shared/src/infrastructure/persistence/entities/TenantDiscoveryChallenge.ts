import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** One-time proof that the browser can receive mail for an existing shard user. */
@Entity({ name: 'tenant_discovery_challenges', schema: 'main' })
@Index('idx_tenant_discovery_challenges_token', ['tokenHash'], { unique: true })
@Index('uq_tenant_discovery_challenges_user', ['userId'], { unique: true })
export class TenantDiscoveryChallenge extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'consumed_at', type: 'bigint', nullable: true })
  consumedAt!: number | null;
}
