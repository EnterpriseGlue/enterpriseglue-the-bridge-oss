import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'environment_tags', schema: 'main' })
export class EnvironmentTag extends AppBaseEntity {
  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', default: '#6b7280' })
  color!: string;

  @Column({ name: 'manual_deploy_allowed', type: 'boolean', default: true })
  manualDeployAllowed!: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
