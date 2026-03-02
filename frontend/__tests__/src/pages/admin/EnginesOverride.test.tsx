import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtensionPage } from '@src/enterprise/ExtensionSlot';

describe('Engines route extension fallback', () => {
  it('renders OSS fallback when engines-page override is not registered', () => {
    render(
      <ExtensionPage
        name="engines-page"
        fallback={<div>OSS Engines Fallback</div>}
      />
    );

    expect(screen.getByText('OSS Engines Fallback')).toBeInTheDocument();
  });
});
