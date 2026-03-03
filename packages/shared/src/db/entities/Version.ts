import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'versions', schema: 'main' })
export class Version extends AppBaseEntity {
  @Column({ name: 'file_id', type: 'text' })
  fileId!: string;

  @Column({ type: 'text', nullable: true })
  author!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text' })
  xml!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
