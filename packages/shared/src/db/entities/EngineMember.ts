import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_members', schema: 'main' })
@Unique(['engineId', 'userId'])
@Index('idx_engine_members_engine', ['engineId'])
@Index('idx_engine_members_user', ['userId'])
export class EngineMember extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  role!: string;

  @Column({ name: 'granted_by_id', type: 'text', nullable: true })
  grantedById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
