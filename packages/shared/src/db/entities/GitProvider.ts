import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_providers', schema: 'main' })
export class GitProvider extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ name: 'api_url', type: 'text' })
  apiUrl!: string;

  @Column({ name: 'custom_base_url', type: 'text', nullable: true })
  customBaseUrl!: string | null;

  @Column({ name: 'custom_api_url', type: 'text', nullable: true })
  customApiUrl!: string | null;

  @Column({ name: 'oauth_client_id', type: 'text', nullable: true })
  oauthClientId!: string | null;

  @Column({ name: 'oauth_client_secret', type: 'text', nullable: true })
  oauthClientSecret!: string | null;

  @Column({ name: 'oauth_scopes', type: 'text', nullable: true })
  oauthScopes!: string | null;

  @Column({ name: 'oauth_auth_url', type: 'text', nullable: true })
  oauthAuthUrl!: string | null;

  @Column({ name: 'oauth_token_url', type: 'text', nullable: true })
  oauthTokenUrl!: string | null;

  @Column({ name: 'supports_oauth', type: 'boolean', default: false })
  supportsOAuth!: boolean;

  @Column({ name: 'supports_pat', type: 'boolean', default: true })
  supportsPAT!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
