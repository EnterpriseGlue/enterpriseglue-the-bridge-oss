import { describe, it, expect } from 'vitest';
import * as versioningSchemas from '../../../../packages/backend-host/src/modules/versioning/schemas/index.js';

describe('versioning schemas index', () => {
  it('loads versioning schemas module', () => {
    expect(versioningSchemas).toBeDefined();
  });
});
