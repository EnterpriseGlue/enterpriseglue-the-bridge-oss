import { describe, expect, it } from 'vitest';
import { redactExternalEngineAuditDetails } from '../../../../packages/backend-host/src/modules/platform-admin/routes/authz/external-engine-serialization.js';

describe('external engine audit serialization', () => {
  it('redacts credential-shaped detail keys recursively without hiding operational context', () => {
    const details = redactExternalEngineAuditDetails({
      connectionTest: { status: 'disconnected', peerToken: 'must-not-leak', nested: { passwordEnc: 'must-not-leak' } },
      lifecycleStatus: 'active',
      events: [{ authorization: 'Bearer must-not-leak', action: 'retry' }],
    });

    expect(details).toEqual({
      connectionTest: { status: 'disconnected', peerToken: '[REDACTED]', nested: { passwordEnc: '[REDACTED]' } },
      lifecycleStatus: 'active',
      events: [{ authorization: '[REDACTED]', action: 'retry' }],
    });
    expect(JSON.stringify(details)).not.toContain('must-not-leak');
  });
});
