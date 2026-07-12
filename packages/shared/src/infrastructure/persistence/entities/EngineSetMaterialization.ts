import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_set_materializations', schema: 'main' })
@Unique('uq_engine_set_materializations_member', ['engineSetId', 'engineId'])
@Index('idx_engine_set_materializations_tenant', ['tenantId'])
@Index('idx_engine_set_materializations_set', ['engineSetId'])
@Index('idx_engine_set_materializations_engine', ['engineId'])
@Index('idx_engine_set_materializations_fingerprint', ['selectorFingerprint'])
export class EngineSetMaterialization extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'engine_set_id', type: 'text' })
  engineSetId!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'selector_fingerprint', type: 'text' })
  selectorFingerprint!: string;

  @Column({ name: 'matched_by_json', type: 'text' })
  matchedByJson!: string;

  @Column({ name: 'lineage_json', type: 'text' })
  lineageJson!: string;

  @Column({ type: 'text', default: 'engine_set' })
  source!: string;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'last_seen_at', type: 'bigint' })
  lastSeenAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
