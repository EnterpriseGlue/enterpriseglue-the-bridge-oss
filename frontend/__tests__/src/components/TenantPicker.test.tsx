import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ExtensionSlot } from '@src/enterprise/ExtensionSlot';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@src/config', () => ({
  config: {
    multiTenant: false,
  },
}));

describe('TenantPicker', () => {
  it('renders nothing when tenant-picker slot is not registered', () => {
    const { container } = render(<ExtensionSlot name="tenant-picker" />);

    expect(container.firstChild).toBeNull();
  });
});
