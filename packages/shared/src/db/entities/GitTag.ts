import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_tags', schema: 'main' })
@Unique(['repositoryId', 'name'])
@Index('idx_git_tags_repository_id', ['repositoryId', 'createdAt'])
export class GitTag extends AppBaseEntity {
  @Column({ name: 'repository_id', type: 'text' })
  repositoryId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'commit_sha', type: 'text' })
  commitSha!: string;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'tag_type', type: 'text' })
  tagType!: string;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
