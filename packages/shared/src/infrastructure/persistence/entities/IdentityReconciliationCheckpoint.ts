import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'identity_reconciliation_checkpoints', schema: 'main' })
@Unique('uq_identity_reconciliation_checkpoint_provider', ['providerId'])
@Index('idx_identity_reconciliation_checkpoint_lease', ['leaseExpiresAt'])
export class IdentityReconciliationCheckpoint extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'provider_id', type: 'text' }) providerId!: string;
  @Column({ type: 'text', nullable: true }) cursor!: string | null;
  @Column({ name: 'last_success_at', type: 'bigint', nullable: true }) lastSuccessAt!: number | null;
  @Column({ name: 'lease_id', type: 'text', nullable: true }) leaseId!: string | null;
  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true }) leaseExpiresAt!: number | null;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
