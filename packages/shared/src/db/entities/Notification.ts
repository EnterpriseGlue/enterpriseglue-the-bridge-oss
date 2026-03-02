import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Index('idx_notifications_user', ['userId'])
@Index('idx_notifications_tenant', ['tenantId'])
@Index('idx_notifications_state', ['state'])
@Index('idx_notifications_created', ['createdAt'])
@Index('idx_notifications_read', ['readAt'])
@Entity({ name: 'notifications', schema: 'main' })
export class Notification extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  state!: 'success' | 'info' | 'warning' | 'error';

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  subtitle!: string | null;

  @Column({ name: 'read_at', type: 'bigint', nullable: true })
  readAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
