import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'deployment_receipts', schema: 'main' })
@Unique('uq_deployment_receipt_idempotency', ['tenantId', 'idempotencyKey'])
@Index('idx_deployment_receipt_engine', ['engineId', 'receivedAt'])
export class DeploymentReceipt extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'idempotency_key', type: 'text' }) idempotencyKey!: string;
  @Column({ name: 'project_id', type: 'text' }) projectId!: string;
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ name: 'engine_deployment_id', type: 'text' }) engineDeploymentId!: string;
  @Column({ name: 'source', type: 'text' }) source!: string;
  @Column({ name: 'lineage_json', type: 'text', default: '{}' }) lineageJson!: string;
  @Column({ name: 'received_at', type: 'bigint' }) receivedAt!: number;
}
