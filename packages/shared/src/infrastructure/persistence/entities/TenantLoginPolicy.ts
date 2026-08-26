import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantLocalPasswordMode = 'auto' | 'enabled' | 'disabled';
export type TenantProviderSelectionMode = 'auto_redirect_single' | 'chooser' | 'progressive';

/** Tenant-owned login policy; provider secrets remain opaque references. */
@Entity({ name: 'tenant_login_policies', schema: 'main' })
@Index('uq_tenant_login_policies_tenant', ['tenantId'], { unique: true })
export class TenantLoginPolicy extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'local_password_mode', type: 'text', default: 'auto' })
  localPasswordMode!: TenantLocalPasswordMode;

  @Column({ name: 'provider_selection_mode', type: 'text', default: 'chooser' })
  providerSelectionMode!: TenantProviderSelectionMode;

  @Column({ name: 'updated_by_user_id', type: 'text', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
