import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'comments', schema: 'main' })
export class Comment extends AppBaseEntity {
  @Column({ name: 'file_id', type: 'text' })
  fileId!: string;

  @Column({ type: 'text', nullable: true })
  author!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
