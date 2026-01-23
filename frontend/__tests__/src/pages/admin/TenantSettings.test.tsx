import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtensionPage } from '@src/enterprise/ExtensionSlot';

describe('TenantSettings', () => {
  it('renders fallback when tenant settings page is not registered', () => {
    render(<ExtensionPage name="tenant-settings-page" fallback={<div>EE required</div>} />);

    expect(screen.getByText('EE required')).toBeInTheDocument();
  });
});
