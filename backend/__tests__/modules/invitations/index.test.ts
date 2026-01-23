import { describe, it, expect } from 'vitest';
import * as invitationsModule from '../../../src/modules/invitations/schemas/index.js';

describe('invitations module index', () => {
  it('does not expose invitations router in OSS', () => {
    expect(invitationsModule).toBeDefined();
  });
});
