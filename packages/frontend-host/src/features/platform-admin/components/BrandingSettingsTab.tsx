/**
 * Branding Settings Tab Component
 * Allows platform admins to configure platform-wide branding (logo and title)
 */

import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Tile,
  TextInput,
  InlineNotification,
  SkeletonPlaceholder,
  Slider,
  Select,
  SelectItem,
  NumberInput,
} from '@carbon/react';
import { Reset, Upload, TrashCan } from '@carbon/icons-react';
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import logoPng from '../../../assets/logo.png';

const BRANDING_CACHE_KEY = 'eg.platformBranding.v1';

function writeCachedBranding(branding: Record<string, any>): void {
  try {
    window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
  } catch {
  }
}

interface PlatformBranding {
  logoUrl: string | null;
  loginLogoUrl: string | null;
  loginTitleVerticalOffset: number;
  loginTitleColor: string | null;
  logoTitle: string | null;
  logoScale: number;
  titleFontUrl: string | null;
  titleFontWeight: string;
  titleFontSize: number;
  titleVerticalOffset: number;
  menuAccentColor: string | null;
  faviconUrl: string | null;
}

async function fetchBranding(): Promise<PlatformBranding> {
  return apiClient.get<PlatformBranding>('/api/admin/branding', undefined, {
    credentials: 'include',
  });
}

async function updateBranding(data: Partial<PlatformBranding>): Promise<void> {
  await apiClient.put('/api/admin/branding', data, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resetBranding(): Promise<void> {
  await apiClient.delete('/api/admin/branding', {
    credentials: 'include',
  });
}

interface BrandingSettingsTabProps {
  canManageSettings?: boolean;
  settingsUnavailableReason?: string | null;
}

export default function BrandingSettingsTab({
  canManageSettings = true,
  settingsUnavailableReason,
}: BrandingSettingsTabProps = {}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loginLogoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const [logoTitle, setLogoTitle] = useState('');
  const [logoScale, setLogoScale] = useState(100);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loginLogoPreviewUrl, setLoginLogoPreviewUrl] = useState<string | null>(null);
  const [loginTitleVerticalOffset, setLoginTitleVerticalOffset] = useState(0);
  const [loginTitleColor, setLoginTitleColor] = useState<string | null>(null);
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(null);
  const [titleFontUrl, setTitleFontUrl] = useState<string | null>(null);
  const [titleFontWeight, setTitleFontWeight] = useState('600');
  const [titleFontSize, setTitleFontSize] = useState(14);
  const [titleVerticalOffset, setTitleVerticalOffset] = useState(0);
  const [menuAccentColor, setMenuAccentColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const disabledReason = settingsUnavailableReason || 'Missing permission platform:settings:manage';

  const brandingQuery = useQuery({
    queryKey: ['platform-branding'],
    queryFn: fetchBranding,
  });

  // Sync local state when data loads
  React.useEffect(() => {
    if (brandingQuery.data) {
      setLogoTitle(brandingQuery.data.logoTitle || '');
      setLogoScale(brandingQuery.data.logoScale ?? 100);
      setPreviewUrl(brandingQuery.data.logoUrl);
      setLoginLogoPreviewUrl(brandingQuery.data.loginLogoUrl);
      setLoginTitleVerticalOffset(brandingQuery.data.loginTitleVerticalOffset ?? 0);
      setLoginTitleColor(brandingQuery.data.loginTitleColor);
      setFaviconPreviewUrl(brandingQuery.data.faviconUrl);
      setTitleFontUrl(brandingQuery.data.titleFontUrl);
      setTitleFontWeight(brandingQuery.data.titleFontWeight ?? '600');
      setTitleFontSize(brandingQuery.data.titleFontSize ?? 14);
      setTitleVerticalOffset(brandingQuery.data.titleVerticalOffset ?? 0);
      setMenuAccentColor(brandingQuery.data.menuAccentColor);
      setIsDirty(false);
    }
  }, [brandingQuery.data]);

  const handleFaviconFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/svg+xml'];
    const validExtensions = ['.ico', '.png', '.svg'];
    const hasValidExt = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

    if (!validTypes.includes(file.type) && !hasValidExt) {
      setError('Please upload a favicon file (ICO, PNG, or SVG)');
      return;
    }

    if (file.size > 200 * 1024) {
      setError('Favicon must be less than 200KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setFaviconPreviewUrl(dataUrl);
      setIsDirty(true);
      setError(null);
    };
    reader.onerror = () => {
      setError('Failed to read favicon file');
    };
    reader.readAsDataURL(file);
  }, [canManageSettings]);

  const handleLoginLogoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, SVG, etc.)');
      return;
    }

    if (file.size > 500 * 1024) {
      setError('Image must be less than 500KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLoginLogoPreviewUrl(dataUrl);
      setIsDirty(true);
      setError(null);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsDataURL(file);
  }, [canManageSettings]);

  const handleRemoveFavicon = () => {
    if (!canManageSettings) return;
    setFaviconPreviewUrl(null);
    setIsDirty(true);
    if (faviconInputRef.current) {
      faviconInputRef.current.value = '';
    }
  };

  const updateMutation = useMutation({
    mutationFn: (data: Partial<PlatformBranding>) =>
      canManageSettings ? updateBranding(data) : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-branding'] });
      setIsDirty(false);
      setError(null);
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to save branding');
      setError(parsed.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => canManageSettings ? resetBranding() : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-branding'] });
      setPreviewUrl(null);
      setLoginLogoPreviewUrl(null);
      setLoginTitleVerticalOffset(0);
      setLoginTitleColor(null);
      setFaviconPreviewUrl(null);
      setLogoTitle('');
      setLogoScale(100);
      setTitleFontUrl(null);
      setTitleFontWeight('600');
      setTitleFontSize(14);
      setTitleVerticalOffset(0);
      setMenuAccentColor(null);
      setIsDirty(false);
      setError(null);
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to reset branding');
      setError(parsed.message);
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, SVG, etc.)');
      return;
    }

    // Validate file size (max 500KB for base64 storage)
    if (file.size > 500 * 1024) {
      setError('Image must be less than 500KB');
      return;
    }

    // Convert to base64 data URL
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewUrl(dataUrl);
      setIsDirty(true);
      setError(null);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsDataURL(file);
  }, [canManageSettings]);

  const handleSave = () => {
    if (!canManageSettings) {
      setError(disabledReason);
      return;
    }
    if (loginTitleColor && !/^#[0-9A-Fa-f]{6}$/.test(loginTitleColor)) {
      setError('Login title color must be a 6-digit hex value like #112233');
      return;
    }
    if (menuAccentColor && !/^#[0-9A-Fa-f]{6}$/.test(menuAccentColor)) {
      setError('Menu accent color must be a 6-digit hex value like #112233');
      return;
    }

    const cachePayload = {
      logoUrl: previewUrl,
      loginLogoUrl: loginLogoPreviewUrl,
      loginTitleVerticalOffset,
      loginTitleColor,
      logoTitle: logoTitle || null,
      logoScale,
      titleFontUrl,
      titleFontWeight,
      titleFontSize,
      titleVerticalOffset,
      menuAccentColor,
      faviconUrl: faviconPreviewUrl,
    };

    updateMutation.mutate({
      logoUrl: previewUrl,
      loginLogoUrl: loginLogoPreviewUrl,
      loginTitleVerticalOffset,
      loginTitleColor,
      faviconUrl: faviconPreviewUrl,
      logoTitle: logoTitle || null,
      logoScale,
      titleFontUrl,
      titleFontWeight,
      titleFontSize,
      titleVerticalOffset,
      menuAccentColor,
    }, {
      onSuccess: () => {
        writeCachedBranding(cachePayload);
      },
    });
  };

  const handleScaleChange = (value: number) => {
    if (!canManageSettings) return;
    setLogoScale(value);
    setIsDirty(true);
  };

  const handleFontFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (woff, woff2, ttf, otf)
    const validTypes = ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/x-font-woff', 'application/font-woff', 'application/font-woff2', 'application/x-font-ttf', 'application/x-font-opentype'];
    const validExtensions = ['.woff', '.woff2', '.ttf', '.otf'];
    const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!validTypes.includes(file.type) && !hasValidExt) {
      setError('Please upload a font file (WOFF, WOFF2, TTF, or OTF)');
      return;
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      setError('Font file must be less than 500KB');
      return;
    }

    // Convert to base64 data URL
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setTitleFontUrl(dataUrl);
      setIsDirty(true);
      setError(null);
    };
    reader.onerror = () => {
      setError('Failed to read font file');
    };
    reader.readAsDataURL(file);
  }, [canManageSettings]);

  const handleRemoveFont = () => {
    if (!canManageSettings) return;
    setTitleFontUrl(null);
    setIsDirty(true);
    if (fontInputRef.current) {
      fontInputRef.current.value = '';
    }
  };

  const handleReset = () => {
    if (!canManageSettings) {
      setError(disabledReason);
      return;
    }

    const cachePayload = {
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
    };

    resetMutation.mutate(undefined, {
      onSuccess: () => {
        writeCachedBranding(cachePayload);
      },
    });
  };

  const handleRemoveLogo = () => {
    if (!canManageSettings) return;
    setPreviewUrl(null);
    setIsDirty(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveLoginLogo = () => {
    if (!canManageSettings) return;
    setLoginLogoPreviewUrl(null);
    setIsDirty(true);
    if (loginLogoInputRef.current) {
      loginLogoInputRef.current.value = '';
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    setLogoTitle(e.target.value);
    setIsDirty(true);
  };

  if (brandingQuery.isLoading) {
    return (
      <PlatformGrid style={{ paddingInline: 0 }}>
        <PlatformRow>
          <PlatformCol sm={4} md={8} lg={16}>
            <Tile>
              <SkeletonPlaceholder style={{ width: '100%', height: '200px' }} />
            </Tile>
          </PlatformCol>
        </PlatformRow>
      </PlatformGrid>
    );
  }

  const currentLogoUrl = previewUrl;
  const currentLoginLogoUrl = loginLogoPreviewUrl;
  const hasCustomBranding = !!(
    brandingQuery.data?.logoUrl ||
    brandingQuery.data?.loginLogoUrl ||
    (brandingQuery.data?.loginTitleVerticalOffset ?? 0) !== 0 ||
    brandingQuery.data?.loginTitleColor ||
    brandingQuery.data?.logoTitle ||
    brandingQuery.data?.titleFontUrl ||
    brandingQuery.data?.menuAccentColor ||
    brandingQuery.data?.faviconUrl
  );

  return (
    <PlatformGrid style={{ paddingInline: 0, alignItems: 'stretch' }}>
      <PlatformRow>
        <PlatformCol sm={4} md={4} lg={8} style={{ display: 'flex', flexDirection: 'column', marginInlineStart: 0 }}>
          <Tile style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>
              Header Branding
            </h3>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              These settings affect the platform header and top navigation across all tenants.
            </p>

            {error && (
              <InlineNotification
                kind="error"
                title="Error"
                subtitle={error}
                onCloseButtonClick={() => setError(null)}
                style={{ marginTop: 'var(--spacing-4)' }}
              />
            )}

            {!canManageSettings && (
              <InlineNotification
                kind="warning"
                title="Branding settings are read-only"
                subtitle={disabledReason}
                hideCloseButton
                lowContrast
                style={{ marginTop: 'var(--spacing-4)' }}
              />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', marginTop: 'var(--spacing-5)' }}>
              <div>
                <p style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '14px', fontWeight: 600 }}>
                  Header Logo
                </p>
                <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Upload a custom logo to replace the EnterpriseGlue logo in the header. This will apply across all tenants.
                </p>

                <div style={{
                  marginBottom: 'var(--spacing-4)',
                  padding: 'var(--spacing-4)',
                  backgroundColor: 'var(--cds-layer-02, #393939)',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '80px',
                }}>
                  {currentLogoUrl ? (
                    <img
                      src={currentLogoUrl}
                      alt="Custom Logo Preview"
                      style={{
                        height: '32px',
                        width: 'auto',
                        maxWidth: '200px',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                      <img
                        src={logoPng}
                        alt="EnterpriseGlue Logo"
                        style={{ height: '16px', width: 'auto' }}
                      />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'white' }}>
                        EnterpriseGlue
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginLeft: 'var(--spacing-2)' }}>
                        (default)
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    disabled={!canManageSettings}
                    style={{ display: 'none' }}
                  />
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Upload}
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload Logo
                  </Button>
                  {currentLogoUrl && (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={TrashCan}
                      disabled={!canManageSettings}
                      title={!canManageSettings ? disabledReason : undefined}
                      onClick={handleRemoveLogo}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <p style={{ margin: 'var(--spacing-3) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Supported formats: PNG, JPG, SVG, WebP. Max size: 500KB.
                </p>
              </div>

              <TextInput
                id="logo-title"
                labelText="Header Title Text"
                placeholder="e.g., My Company"
                value={logoTitle}
                onChange={handleTitleChange}
                helperText="This replaces 'EnterpriseGlue' in the header"
                disabled={!canManageSettings}
              />

              <div>
                <Slider
                  id="logo-scale"
                  labelText={`Logo Size: ${logoScale}%`}
                  min={50}
                  max={200}
                  step={10}
                  value={logoScale}
                  onChange={({ value }) => handleScaleChange(value)}
                  disabled={!canManageSettings}
                />
                <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Adjust the logo size. 100% is the default size.
                </p>
              </div>

              <div>
                <Slider
                  id="title-vertical-offset"
                  labelText={`Header Title Vertical Offset: ${titleVerticalOffset}px`}
                  min={-20}
                  max={20}
                  step={1}
                  value={titleVerticalOffset}
                  onChange={({ value }) => {
                    if (!canManageSettings) return;
                    setTitleVerticalOffset(value);
                    setIsDirty(true);
                  }}
                  disabled={!canManageSettings}
                />
                <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Only affects the header title text.
                </p>
              </div>

              <div>
                <p style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '14px', fontWeight: 600 }}>
                  Menu Accent Color
                </p>
                <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Customize the color of the active menu underline in the header navigation.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                    <input
                      type="color"
                      id="menu-accent-color"
                      value={menuAccentColor || '#0f62fe'}
                      onChange={(e) => {
                        if (!canManageSettings) return;
                        setMenuAccentColor(e.target.value);
                        setIsDirty(true);
                      }}
                      disabled={!canManageSettings}
                      style={{
                        width: '48px',
                        height: '48px',
                        padding: 0,
                        border: '2px solid var(--cds-border-subtle)',
                        borderRadius: '4px',
                        cursor: canManageSettings ? 'pointer' : 'default',
                        backgroundColor: 'transparent',
                      }}
                    />
                    <TextInput
                      id="menu-accent-color-hex"
                      labelText="Hex Color"
                      placeholder="#FF6200"
                      value={menuAccentColor || ''}
                      onChange={(e) => {
                        if (!canManageSettings) return;
                        const val = e.target.value;
                        if (val === '' || /^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                          setMenuAccentColor(val || null);
                          setIsDirty(true);
                        }
                      }}
                      style={{ width: '140px' }}
                      disabled={!canManageSettings}
                    />
                  </div>
                  {menuAccentColor && (
                    <Button
                      kind="ghost"
                      size="sm"
                      disabled={!canManageSettings}
                      title={!canManageSettings ? disabledReason : undefined}
                      onClick={() => {
                        if (!canManageSettings) return;
                        setMenuAccentColor(null);
                        setIsDirty(true);
                      }}
                    >
                      Reset to Default
                    </Button>
                  )}
                </div>
                <p style={{ margin: 'var(--spacing-3) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Default: #0f62fe (Carbon blue). ING Orange: #FF6200
                </p>
              </div>
            </div>
          </Tile>
        </PlatformCol>

        <PlatformCol
          sm={4}
          md={4}
          lg={8}
          style={{ display: 'flex', flexDirection: 'column', marginInlineEnd: 0 }}
        >
          <Tile style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '18px', fontWeight: 600 }}>
              Login Page Branding
            </h3>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              These settings affect the login screen only.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', marginTop: 'var(--spacing-5)' }}>
              <div>
                <p style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '14px', fontWeight: 600 }}>
                  Login Page Logo
                </p>
                <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Optional: upload a separate logo for the login page on light backgrounds. If empty, the header logo will be used.
                </p>

                <div style={{
                  marginBottom: 'var(--spacing-4)',
                  padding: 'var(--spacing-4)',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  border: '1px solid var(--cds-border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '80px',
                }}>
                  {currentLoginLogoUrl ? (
                    <img
                      src={currentLoginLogoUrl}
                      alt="Login Logo Preview"
                      style={{
                        height: '32px',
                        width: 'auto',
                        maxWidth: '200px',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                      <img
                        src={currentLogoUrl || logoPng}
                        alt="Platform Logo"
                        style={{ height: '16px', width: 'auto' }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        Using header logo
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                  <input
                    ref={loginLogoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLoginLogoFileChange}
                    disabled={!canManageSettings}
                    style={{ display: 'none' }}
                  />
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Upload}
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={() => loginLogoInputRef.current?.click()}
                  >
                    Upload Login Logo
                  </Button>
                  {currentLoginLogoUrl && (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={TrashCan}
                      disabled={!canManageSettings}
                      title={!canManageSettings ? disabledReason : undefined}
                      onClick={handleRemoveLoginLogo}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <p style={{ margin: 'var(--spacing-3) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Supported formats: PNG, JPG, SVG, WebP. Max size: 500KB.
                </p>
              </div>

              <div>
                <Slider
                  id="login-title-vertical-offset"
                  labelText={`Login Title Vertical Offset: ${loginTitleVerticalOffset}px`}
                  min={-50}
                  max={50}
                  step={1}
                  value={loginTitleVerticalOffset}
                  onChange={({ value }) => {
                    if (!canManageSettings) return;
                    setLoginTitleVerticalOffset(value);
                    setIsDirty(true);
                  }}
                  disabled={!canManageSettings}
                />
                <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Only affects the login page title text.
                </p>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                    <input
                      type="color"
                      id="login-title-color"
                      value={loginTitleColor || '#000000'}
                      onChange={(e) => {
                        if (!canManageSettings) return;
                        setLoginTitleColor(e.target.value);
                        setIsDirty(true);
                      }}
                      disabled={!canManageSettings}
                      style={{
                        width: '48px',
                        height: '48px',
                        padding: 0,
                        border: '2px solid var(--cds-border-subtle)',
                        borderRadius: '4px',
                        cursor: canManageSettings ? 'pointer' : 'default',
                        backgroundColor: 'transparent',
                      }}
                    />
                    <TextInput
                      id="login-title-color-hex"
                      labelText="Login Title Color (Hex)"
                      placeholder="#000000"
                      value={loginTitleColor || ''}
                      onChange={(e) => {
                        if (!canManageSettings) return;
                        const val = e.target.value;
                        if (val === '' || /^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                          setLoginTitleColor(val || null);
                          setIsDirty(true);
                        }
                      }}
                      style={{ width: '160px' }}
                      disabled={!canManageSettings}
                    />
                  </div>
                  {loginTitleColor && (
                    <Button
                      kind="ghost"
                      size="sm"
                      disabled={!canManageSettings}
                      title={!canManageSettings ? disabledReason : undefined}
                      onClick={() => {
                        if (!canManageSettings) return;
                        setLoginTitleColor(null);
                        setIsDirty(true);
                      }}
                    >
                      Reset to Default
                    </Button>
                  )}
                </div>
                <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Only affects the login page title text.
                </p>
              </div>
            </div>
          </Tile>
        </PlatformCol>
      </PlatformRow>

      <PlatformRow>
        <PlatformCol
          sm={4}
          md={4}
          lg={8}
          style={{ display: 'flex', flexDirection: 'column', marginInlineStart: 0, marginTop: 'var(--spacing-7)' }}
        >
          <Tile style={{ flex: 1 }}>
            <h2 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '18px', fontWeight: 600 }}>
              Brand Font
            </h2>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              These settings apply to both the header title and the login page title.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', marginTop: 'var(--spacing-5)' }}>
              <div style={{
                padding: 'var(--spacing-3)',
                backgroundColor: 'var(--cds-layer-02, #393939)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px',
              }}>
                {titleFontUrl ? (
                  <span style={{ fontSize: '14px', color: 'var(--cds-text-primary)' }}>
                    Custom font loaded
                  </span>
                ) : (
                  <span style={{ fontSize: '14px', color: 'var(--cds-text-secondary)' }}>
                    Using default system font
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                <input
                  ref={fontInputRef}
                  type="file"
                  accept=".woff,.woff2,.ttf,.otf"
                  onChange={handleFontFileChange}
                  disabled={!canManageSettings}
                  style={{ display: 'none' }}
                />
                <Button
                  kind="tertiary"
                  size="sm"
                  renderIcon={Upload}
                  disabled={!canManageSettings}
                  title={!canManageSettings ? disabledReason : undefined}
                  onClick={() => fontInputRef.current?.click()}
                >
                  Upload Font
                </Button>
                {titleFontUrl && (
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={TrashCan}
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={handleRemoveFont}
                  >
                    Remove
                  </Button>
                )}
              </div>

              <p style={{ margin: '-8px 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Max size: 500KB. Tip: Use WOFF2 for best compression.
              </p>

              <Select
                id="title-font-weight"
                labelText="Font Weight"
                value={titleFontWeight}
                onChange={(e) => {
                  if (!canManageSettings) return;
                  setTitleFontWeight(e.target.value);
                  setIsDirty(true);
                }}
                disabled={!canManageSettings}
              >
                <SelectItem value="400" text="Regular (400)" />
                <SelectItem value="500" text="Medium (500)" />
                <SelectItem value="600" text="Semi-Bold (600)" />
                <SelectItem value="700" text="Bold (700)" />
                <SelectItem value="800" text="Extra Bold (800)" />
              </Select>

              <NumberInput
                id="title-font-size"
                label="Font Size (px)"
                min={10}
                max={32}
                step={1}
                value={titleFontSize}
                onChange={(_e, { value }) => {
                  if (!canManageSettings) return;
                  setTitleFontSize(value as number);
                  setIsDirty(true);
                }}
                helperText="Used as the base size for header and login page title text"
                disabled={!canManageSettings}
              />
            </div>
          </Tile>
        </PlatformCol>

        <PlatformCol
          sm={4}
          md={4}
          lg={8}
          style={{ display: 'flex', flexDirection: 'column', marginInlineEnd: 0, marginTop: 'var(--spacing-7)' }}
        >
          <Tile style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>
              Favicon
            </h3>
            <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Override the browser tab favicon for the platform. This will apply across all tenants.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  border: '1px solid var(--cds-border-subtle)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'white',
                }}
              >
                {faviconPreviewUrl ? (
                  <img src={faviconPreviewUrl} alt="Favicon preview" style={{ width: 24, height: 24 }} />
                ) : (
                  <img src="/favicon-light.ico" alt="Default favicon" style={{ width: 24, height: 24 }} />
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept=".ico,.png,.svg,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml"
                  onChange={handleFaviconFileChange}
                  disabled={!canManageSettings}
                  style={{ display: 'none' }}
                />
                <Button
                  kind="tertiary"
                  size="sm"
                  renderIcon={Upload}
                  disabled={!canManageSettings}
                  title={!canManageSettings ? disabledReason : undefined}
                  onClick={() => faviconInputRef.current?.click()}
                >
                  Upload Favicon
                </Button>
                {faviconPreviewUrl && (
                  <Button
                    kind="ghost"
                    size="sm"
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={handleRemoveFavicon}
                  >
                    Reset to Default
                  </Button>
                )}
              </div>
            </div>

            <p style={{ margin: 'var(--spacing-3) 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              Recommended: ICO or PNG (32x32). Max size: 200KB.
            </p>
          </Tile>
        </PlatformCol>
      </PlatformRow>

      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-3)',
            justifyContent: 'flex-end',
            marginTop: 'var(--spacing-4)',
          }}>
            {hasCustomBranding && (
              <Button
                kind="ghost"
                size="md"
                renderIcon={Reset}
                onClick={handleReset}
                disabled={resetMutation.isPending || !canManageSettings}
                title={!canManageSettings ? disabledReason : undefined}
              >
                {resetMutation.isPending ? 'Resetting...' : 'Reset to Default'}
              </Button>
            )}
            <Button
              kind="primary"
              size="md"
              onClick={handleSave}
              disabled={!isDirty || updateMutation.isPending || !canManageSettings}
              title={!canManageSettings ? disabledReason : undefined}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  );
}
