import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'refresh_tokens', schema: 'main' })
@Index('idx_refresh_tokens_user', ['userId'])
@Index('idx_refresh_tokens_identity_provider', ['identityProviderId', 'revokedAt'])
@Index('idx_refresh_tokens_provider_subject', ['identityProviderId', 'providerSubjectId', 'revokedAt'])
@Index('idx_refresh_tokens_provider_session', ['identityProviderId', 'providerSessionId', 'revokedAt'])
export class RefreshToken extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'identity_provider_id', type: 'text', nullable: true })
  identityProviderId!: string | null;

  /** Verified federated subject used only for targeted provider logout. */
  @Column({ name: 'provider_subject_id', type: 'text', nullable: true })
  providerSubjectId!: string | null;

  /** OIDC sid or SAML SessionIndex used only for targeted provider logout. */
  @Column({ name: 'provider_session_id', type: 'text', nullable: true })
  providerSessionId!: string | null;

  /** SAML NameID format needed to construct a standards-compliant LogoutRequest. */
  @Column({ name: 'provider_name_id_format', type: 'text', nullable: true })
  providerNameIdFormat!: string | null;

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
