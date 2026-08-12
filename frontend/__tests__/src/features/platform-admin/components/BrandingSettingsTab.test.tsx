import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BrandingSettingsTab from '@src/features/platform-admin/components/BrandingSettingsTab';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderBrandingSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrandingSettingsTab />
    </QueryClientProvider>
  );
}

describe('BrandingSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockResolvedValue({
      logoUrl: null,
      loginLogoUrl: null,
      loginTitleVerticalOffset: 0,
      loginTitleColor: null,
      logoTitle: null,
      logoScale: 100,
      titleFontUrl: null,
      titleFontWeight: '600',
      titleFontSize: 14,
      titleVerticalOffset: 0,
      menuAccentColor: null,
      faviconUrl: null,
    });
  });

  it('groups settings into four half-width branding blocks', async () => {
    renderBrandingSettings();

    await waitFor(() => {
      expect(screen.getByText('Header Branding')).toBeInTheDocument();
    });

    const headerBranding = screen.getByText('Header Branding');
    const loginBranding = screen.getByText('Login Page Branding');
    const brandFont = screen.getByText('Brand Font');
    const favicon = screen.getByText('Favicon');

    expect(screen.getByText('Header Logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Header Title Text')).toBeInTheDocument();
    expect(screen.getByText('Menu Accent Color')).toBeInTheDocument();
    expect(screen.getByText('Login Page Logo')).toBeInTheDocument();
    expect(screen.getByLabelText(/Login Title Color \(Hex\)/i)).toBeInTheDocument();
    expect(screen.getByText('Upload Font')).toBeInTheDocument();

    expect(headerBranding.compareDocumentPosition(loginBranding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(loginBranding.compareDocumentPosition(brandFont) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(brandFont.compareDocumentPosition(favicon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });

  it('renders configuration-owned branding read-only with its lineage', async () => {
    (apiClient.get as any).mockResolvedValue({
      logoUrl: null,
      loginLogoUrl: null,
      loginTitleVerticalOffset: 0,
      loginTitleColor: null,
      logoTitle: 'Configured brand',
      logoScale: 100,
      titleFontUrl: null,
      titleFontWeight: '600',
      titleFontSize: 14,
      titleVerticalOffset: 0,
      menuAccentColor: null,
      faviconUrl: null,
      ownership: {
        section: 'branding',
        sourceRef: 'config_bundle:headless.admin',
        ownershipMode: 'config_locked',
        sourceHash: 'hash',
        lastAppliedAt: 1,
        driftStatus: 'in_sync',
        generation: 1,
      },
    });

    renderBrandingSettings();

    expect(await screen.findByText('Branding settings are read-only')).toBeInTheDocument();
    expect(screen.getByText(/Update bundle headless\.admin and apply it again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Reset to Default' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
