import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'service_accounts', schema: 'main' })
@Index('idx_service_accounts_active', ['isActive'])
@Index('idx_service_accounts_created_by', ['createdById'])
export class ServiceAccount extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'token_prefix', type: 'text', nullable: true })
  tokenPrefix!: string | null;

  @Column({ name: 'secret_hash', type: 'text', nullable: true })
  secretHash!: string | null;

  @Column({ name: 'scopes_json', type: 'text', nullable: true })
  scopesJson!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'last_used_at', type: 'bigint', nullable: true })
  lastUsedAt!: number | null;

  @Column({ name: 'revoked_at', type: 'bigint', nullable: true })
  revokedAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
