import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'email_send_configs', schema: 'main' })
export class EmailSendConfig extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  @Column({ name: 'from_name', type: 'text' })
  fromName!: string;

  @Column({ name: 'from_email', type: 'text' })
  fromEmail!: string;

  @Column({ name: 'reply_to', type: 'text', nullable: true })
  replyTo!: string | null;

  @Column({ name: 'smtp_host', type: 'text', nullable: true })
  smtpHost!: string | null;

  @Column({ name: 'smtp_port', type: 'integer', nullable: true })
  smtpPort!: number | null;

  @Column({ name: 'smtp_secure', type: 'boolean', default: true })
  smtpSecure!: boolean;

  @Column({ name: 'smtp_user', type: 'text', nullable: true })
  smtpUser!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'created_by_user_id', type: 'text', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'updated_by_user_id', type: 'text', nullable: true })
  updatedByUserId!: string | null;
}
