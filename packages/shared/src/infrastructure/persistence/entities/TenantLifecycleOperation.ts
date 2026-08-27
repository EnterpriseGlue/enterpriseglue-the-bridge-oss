import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantLifecycleCommand = 'create' | 'suspend' | 'resume' | 'reconcile_aliases';
export type TenantLifecycleOperationStatus = 'pending' | 'completed' | 'failed';

/** Secret-free idempotency and signed receipt ledger for workload tenant commands. */
@Entity({ name: 'tenant_lifecycle_operations', schema: 'main' })
@Index('uq_tenant_lifecycle_operation_idempotency', ['actorId', 'command', 'idempotencyKeyHash'], { unique: true })
@Index('idx_tenant_lifecycle_operations_tenant', ['tenantId', 'createdAt'])
export class TenantLifecycleOperation extends AppBaseEntity {
  @Column({ name: 'actor_id', type: 'text' })
  actorId!: string;

  @Column({ type: 'text' })
  command!: TenantLifecycleCommand;

  @Column({ name: 'idempotency_key_hash', type: 'text' })
  idempotencyKeyHash!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  status!: TenantLifecycleOperationStatus;

  @Column({ name: 'receipt_json', type: 'text' })
  receiptJson!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
