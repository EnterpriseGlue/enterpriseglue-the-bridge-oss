import 'reflect-metadata';
import { PrimaryColumn, BeforeInsert } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

export abstract class AppBaseEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = generateId();
    }
  }
}
