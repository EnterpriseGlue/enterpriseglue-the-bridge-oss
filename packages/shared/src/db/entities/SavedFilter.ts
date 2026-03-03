import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'saved_filters', schema: 'main' })
export class SavedFilter extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'def_keys', type: 'text' })
  defKeys!: string;

  @Column({ type: 'integer', nullable: true })
  version!: number | null;

  @Column({ name: 'f_active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'f_incidents', type: 'boolean', default: true })
  incidents!: boolean;

  @Column({ name: 'f_completed', type: 'boolean', default: false })
  completed!: boolean;

  @Column({ name: 'f_canceled', type: 'boolean', default: false })
  canceled!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
