import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export type PlatformSettingsSection =
  | 'governance'
  | 'login'
  | 'general'
  | 'git_sync'
  | 'deployment'
  | 'invitations'
  | 'pii'
  | 'branding';

/** Durable ownership and drift state for independently managed settings sections. */
@Entity({ name: 'platform_settings_section_ownership', schema: 'main' })
@Unique('uq_platform_settings_section_ownership_scope', ['settingsId', 'section'])
@Index('idx_platform_settings_section_ownership_source', ['sourceRef'])
export class PlatformSettingsSectionOwnership {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'settings_id', type: 'text', default: 'default' })
  settingsId!: string;

  @Column({ type: 'text' })
  section!: PlatformSettingsSection;

  /** Tenant/platform scope that owns this globally unique settings section. */
  @Column({ name: 'scope_key', type: 'text', default: 'platform' })
  scopeKey!: string;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' })
  ownershipMode!: 'manual' | 'config_locked' | 'config_warn';

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: 'in_sync' | 'drifted' | null;

  @Column({ name: 'generation', type: 'bigint', default: 0 })
  generation!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
