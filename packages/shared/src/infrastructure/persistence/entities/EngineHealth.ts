import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';
import { bigintNumberTransformer } from '../transformers/bigintNumber.js';

@Entity({ name: 'engine_health', schema: 'main' })
export class EngineHealth extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'checked_at', type: 'bigint', transformer: bigintNumberTransformer })
  checkedAt!: number;

  @Column({ name: 'last_check', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  lastCheck!: number | null;

  @Column({ name: 'created_at', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  createdAt!: number | null;

  @Column({ name: 'updated_at', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  updatedAt!: number | null;
}
