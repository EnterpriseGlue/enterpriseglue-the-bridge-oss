import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'role_permissions', schema: 'main' })
@Unique(['roleId', 'permissionId'])
@Index('idx_role_permissions_role', ['roleId'])
@Index('idx_role_permissions_permission', ['permissionId'])
export class RbacRolePermission extends AppBaseEntity {
  @Column({ name: 'role_id', type: 'text' })
  roleId!: string;

  @Column({ name: 'permission_id', type: 'text' })
  permissionId!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
