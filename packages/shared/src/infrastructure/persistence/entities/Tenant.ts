import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantStatus = 'active' | 'suspended' | 'deleting';

/** Native OSS tenant authority. One customer organization maps to one row. */
@Entity({ name: 'tenants', schema: 'main' })
@Unique('uq_tenants_slug', ['slug'])
@Index('idx_tenants_status', ['status'])
export class Tenant extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  slug!: string;

  @Column({ type: 'text', default: 'active' })
  status!: TenantStatus;

  @Column({ name: 'placement_key', type: 'text', nullable: true })
  placementKey!: string | null;

  @Column({ name: 'placement_epoch', type: 'bigint', default: 1 })
  placementEpoch!: number;

  @Column({ name: 'created_by_user_id', type: 'text', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
