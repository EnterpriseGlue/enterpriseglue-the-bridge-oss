import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtensionPage } from '@src/enterprise/ExtensionSlot';

describe('TenantUsers', () => {
  it('renders fallback when tenant users page is not registered', () => {
    render(<ExtensionPage name="tenant-users-page" fallback={<div>EE required</div>} />);

    expect(screen.getByText('EE required')).toBeInTheDocument();
  });
});
