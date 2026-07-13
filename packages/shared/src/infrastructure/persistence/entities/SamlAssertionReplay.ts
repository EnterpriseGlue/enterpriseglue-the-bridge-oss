import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * Hash-only replay ledger for direct SAML assertions. It is never an
 * authorization input and intentionally does not retain the assertion.
 */
@Entity({ name: 'saml_assertion_replays', schema: 'main' })
@Index('uq_saml_assertion_replays_provider_hash', ['providerId', 'responseHash'], { unique: true })
@Index('idx_saml_assertion_replays_expiry', ['expiresAt'])
export class SamlAssertionReplay extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ name: 'response_hash', type: 'text' })
  responseHash!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
