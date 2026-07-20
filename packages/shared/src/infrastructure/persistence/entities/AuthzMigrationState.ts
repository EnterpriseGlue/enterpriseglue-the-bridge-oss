import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Durable marker for one-time authorization data projections. */
@Entity({ name: 'authz_migration_states', schema: 'main' })
@Index('uq_authz_migration_states_key', ['key'], { unique: true })
export class AuthzMigrationState extends AppBaseEntity {
  @Column({ type: 'text' })
  key!: string;

  @Column({ name: 'completed_at', type: 'bigint' })
  completedAt!: number;

  @Column({ type: 'text', nullable: true })
  details!: string | null;
}
