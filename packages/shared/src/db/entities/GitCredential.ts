import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_credentials', schema: 'main' })
@Index('idx_git_credentials_user', ['userId'])
@Index('idx_git_credentials_provider', ['providerId'])
export class GitCredential extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ name: 'auth_type', type: 'text', default: 'pat' })
  authType!: string;

  @Column({ name: 'access_token', type: 'text' })
  accessToken!: string;

  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken!: string | null;

  @Column({ name: 'token_type', type: 'text', default: 'Bearer' })
  tokenType!: string;

  @Column({ name: 'expires_at', type: 'bigint', nullable: true })
  expiresAt!: number | null;

  @Column({ type: 'text', nullable: true })
  scopes!: string | null;

  @Column({ name: 'provider_user_id', type: 'text', nullable: true })
  providerUserId!: string | null;

  @Column({ name: 'provider_username', type: 'text', nullable: true })
  providerUsername!: string | null;

  @Column({ type: 'text', nullable: true })
  namespace!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
