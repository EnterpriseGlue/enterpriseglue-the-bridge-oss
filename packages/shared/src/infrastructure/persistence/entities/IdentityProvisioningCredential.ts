import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'identity_provisioning_credentials', schema: 'main' })
@Index('uq_identity_provisioning_credentials_hash', ['tokenHash'], { unique: true })
@Index('idx_identity_provisioning_credentials_directory_status', ['directoryId', 'status'])
@Index('idx_identity_provisioning_credentials_expiry', ['expiresAt'])
export class IdentityProvisioningCredential extends AppBaseEntity {
  @Column({ name: 'directory_id', type: 'text' }) directoryId!: string;
  @Column({ type: 'text' }) name!: string;
  @Column({ name: 'token_hash', type: 'text' }) tokenHash!: string;
  @Column({ type: 'text' }) fingerprint!: string;
  @Column({ type: 'text', default: 'active' }) status!: 'active' | 'overlap' | 'expired' | 'revoked';
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'expires_at', type: 'bigint', nullable: true }) expiresAt!: number | null;
  @Column({ name: 'overlap_ends_at', type: 'bigint', nullable: true }) overlapEndsAt!: number | null;
  @Column({ name: 'last_used_at', type: 'bigint', nullable: true }) lastUsedAt!: number | null;
  @Column({ name: 'revoked_at', type: 'bigint', nullable: true }) revokedAt!: number | null;
  @Column({ name: 'created_by_user_id', type: 'text', nullable: true }) createdByUserId!: string | null;
}
