import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useElementLinkOverlay, ElementLinkOverlayContent } from '@src/features/starbase/hooks/useElementLinkOverlay';

// Mock Carbon components to simplify rendering
vi.mock('@carbon/react', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Theme: ({ children }: any) => <>{children}</>,
  Toggletip: ({ children }: any) => <div data-testid="toggletip">{children}</div>,
  ToggletipButton: ({ children, label }: any) => <button aria-label={label} data-testid="config-pill">{children}</button>,
  ToggletipContent: ({ children }: any) => <div>{children}</div>,
  Toggle: (props: any) => <input type="checkbox" data-testid="toggle" />,
}));

vi.mock('@carbon/icons-react', () => ({
  Link: () => <span data-testid="link-icon">link</span>,
  Settings: () => <span data-testid="settings-icon">settings</span>,
  WarningAltFilled: () => <span data-testid="warning-icon">warning</span>,
}));

describe('useElementLinkOverlay', () => {
  it('exports useElementLinkOverlay hook', () => {
    expect(useElementLinkOverlay).toBeDefined();
    expect(typeof useElementLinkOverlay).toBe('function');
  });
});

describe('ElementLinkOverlayContent', () => {
  const baseProps = {
    status: 'linked' as const,
    linkedLabel: 'Invoice-Receipt',
    linkTypeLabel: 'process',
    canOpen: true,
    onLink: vi.fn(),
    onOpen: vi.fn(),
    onUnlink: vi.fn(),
    onTriggerClick: vi.fn(),
  };

  it('shows both navigation pill and config pill when readOnly is false', () => {
    render(<ElementLinkOverlayContent {...baseProps} readOnly={false} />);

    expect(screen.getByTestId('link-icon')).toBeDefined();
    expect(screen.getByTestId('config-pill')).toBeDefined();
  });

  it('hides config pill (settings gear) when readOnly is true', () => {
    render(<ElementLinkOverlayContent {...baseProps} readOnly={true} />);

    expect(screen.getByTestId('link-icon')).toBeDefined();
    expect(screen.queryByTestId('config-pill')).toBeNull();
  });

  it('shows config pill by default (readOnly not specified)', () => {
    render(<ElementLinkOverlayContent {...baseProps} />);

    expect(screen.getByTestId('config-pill')).toBeDefined();
  });

  it('hides navigation pill when status is unlinked', () => {
    render(
      <ElementLinkOverlayContent {...baseProps} status="unlinked" linkedLabel={null} readOnly={false} />
    );

    expect(screen.queryByTestId('link-icon')).toBeNull();
    expect(screen.getByTestId('config-pill')).toBeDefined();
  });

  it('shows warning icon when status is missing and not readOnly', () => {
    render(
      <ElementLinkOverlayContent {...baseProps} status="missing" readOnly={false} />
    );

    expect(screen.getByTestId('warning-icon')).toBeDefined();
  });
});
