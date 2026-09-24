import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** A credential bound to exactly one verified Cloud account, never to an email address. */
@Entity({ name: 'cloud_passkeys', schema: 'main' })
@Index('uq_cloud_passkeys_credential_hash', ['credentialIdHash'], { unique: true })
@Index('idx_cloud_passkeys_user', ['userId'])
export class CloudPasskey extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' }) userId!: string;
  @Column({ name: 'credential_id', type: 'text' }) credentialId!: string;
  @Column({ name: 'credential_id_hash', type: 'text' }) credentialIdHash!: string;
  @Column({ name: 'public_key', type: 'text' }) publicKey!: string;
  @Column({ type: 'bigint' }) counter!: number;
  @Column({ name: 'transports_json', type: 'text' }) transportsJson!: string;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'last_used_at', type: 'bigint', nullable: true }) lastUsedAt!: number | null;
  @Column({ name: 'revoked_at', type: 'bigint', nullable: true }) revokedAt!: number | null;
}
