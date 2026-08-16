import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'identity_provisioning_diagnostics', schema: 'main' })
@Index('idx_identity_provisioning_diagnostics_directory_time', ['directoryId', 'occurredAt'])
@Index('idx_identity_provisioning_diagnostics_request', ['requestId'])
@Index('idx_identity_provisioning_diagnostics_status', ['status', 'occurredAt'])
@Index('idx_identity_provisioning_diagnostics_resource', ['resourceType', 'resourceId'])
export class IdentityProvisioningDiagnostic extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'directory_id', type: 'text' }) directoryId!: string;
  @Column({ name: 'request_id', type: 'text' }) requestId!: string;
  @Column({ name: 'event_type', type: 'text' }) eventType!: string;
  @Column({ name: 'resource_type', type: 'text', nullable: true }) resourceType!: string | null;
  @Column({ name: 'resource_id', type: 'text', nullable: true }) resourceId!: string | null;
  @Column({ name: 'user_id', type: 'text', nullable: true }) userId!: string | null;
  @Column({ type: 'text' }) status!: 'accepted' | 'success' | 'partial' | 'failed';
  @Column({ type: 'text', nullable: true }) code!: string | null;
  @Column({ type: 'text', nullable: true }) message!: string | null;
  /** Bounded sanitized metadata only; raw protocol payloads and secrets are forbidden. */
  @Column({ name: 'details_json', type: 'text', default: '{}' }) detailsJson!: string;
  @Column({ name: 'occurred_at', type: 'bigint' }) occurredAt!: number;
}
