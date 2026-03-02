import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_providers', schema: 'main' })
export class SsoProvider extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'client_id', type: 'text', nullable: true })
  clientId!: string | null;

  @Column({ name: 'client_secret_enc', type: 'text', nullable: true })
  clientSecretEnc!: string | null;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'issuer_url', type: 'text', nullable: true })
  issuerUrl!: string | null;

  @Column({ name: 'authorization_url', type: 'text', nullable: true })
  authorizationUrl!: string | null;

  @Column({ name: 'token_url', type: 'text', nullable: true })
  tokenUrl!: string | null;

  @Column({ name: 'user_info_url', type: 'text', nullable: true })
  userInfoUrl!: string | null;

  @Column({ type: 'text', default: '["openid", "profile", "email"]' })
  scopes!: string;

  @Column({ name: 'entity_id', type: 'text', nullable: true })
  entityId!: string | null;

  @Column({ name: 'sso_url', type: 'text', nullable: true })
  ssoUrl!: string | null;

  @Column({ name: 'slo_url', type: 'text', nullable: true })
  sloUrl!: string | null;

  @Column({ name: 'certificate_enc', type: 'text', nullable: true })
  certificateEnc!: string | null;

  @Column({ name: 'signature_algorithm', type: 'text', default: 'sha256' })
  signatureAlgorithm!: string;

  @Column({ name: 'callback_url', type: 'text', nullable: true })
  callbackUrl!: string | null;

  @Column({ name: 'icon_url', type: 'text', nullable: true })
  iconUrl!: string | null;

  @Column({ name: 'button_label', type: 'text', nullable: true })
  buttonLabel!: string | null;

  @Column({ name: 'button_color', type: 'text', nullable: true })
  buttonColor!: string | null;

  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder!: number;

  @Column({ name: 'auto_provision', type: 'boolean', default: true })
  autoProvision!: boolean;

  @Column({ name: 'default_role', type: 'text', default: 'user' })
  defaultRole!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;
}
