import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'email_templates', schema: 'main' })
export class EmailTemplate extends AppBaseEntity {
  @Column({ type: 'text', unique: true })
  type!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  subject!: string;

  @Column({ name: 'html_template', type: 'text' })
  htmlTemplate!: string;

  @Column({ name: 'text_template', type: 'text', nullable: true })
  textTemplate!: string | null;

  @Column({ type: 'text', default: '[]' })
  variables!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'created_by_user_id', type: 'text', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'updated_by_user_id', type: 'text', nullable: true })
  updatedByUserId!: string | null;
}
