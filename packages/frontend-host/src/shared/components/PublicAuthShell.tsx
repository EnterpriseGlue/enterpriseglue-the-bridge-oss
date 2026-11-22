import React, { useEffect, useRef, useState } from 'react';
import { Column, Grid, Header, HeaderName, SkipToContent, Stack, Theme, Tile } from '@carbon/react';
import type { PublicPlatformBranding } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { apiClient } from '../api/client';
import logoPng from '../../assets/logo.png';
import processLandscape from '../../assets/login/process-landscape.svg';
import { useWorkspaceHeader } from '../../features/organizations/workspaceHeaderContext';

const BRANDING_CACHE_KEY = 'eg.platformBranding.v1';

function normalizeBranding(raw: unknown): PublicPlatformBranding {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    logoUrl: typeof value.logoUrl === 'string' ? value.logoUrl : null,
    loginLogoUrl: typeof value.loginLogoUrl === 'string' ? value.loginLogoUrl : null,
    loginTitleVerticalOffset: typeof value.loginTitleVerticalOffset === 'number' ? value.loginTitleVerticalOffset : 0,
    loginTitleColor: typeof value.loginTitleColor === 'string' ? value.loginTitleColor : null,
    logoTitle: typeof value.logoTitle === 'string' ? value.logoTitle : null,
    logoScale: typeof value.logoScale === 'number' ? value.logoScale : 100,
    titleFontUrl: typeof value.titleFontUrl === 'string' ? value.titleFontUrl : null,
    titleFontWeight: typeof value.titleFontWeight === 'string' ? value.titleFontWeight : '600',
    titleFontSize: typeof value.titleFontSize === 'number' ? value.titleFontSize : 14,
    titleVerticalOffset: typeof value.titleVerticalOffset === 'number' ? value.titleVerticalOffset : 0,
    menuAccentColor: typeof value.menuAccentColor === 'string' ? value.menuAccentColor : null,
    faviconUrl: typeof value.faviconUrl === 'string' ? value.faviconUrl : null,
  };
}

function readCachedBranding(): PublicPlatformBranding | null {
  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY);
    return raw ? normalizeBranding(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCachedBranding(branding: PublicPlatformBranding): void {
  try {
    window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
  } catch {
  }
}

function makeLogoObjectUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('//') || !trimmed.startsWith('data:')) return null;
  const match = trimmed.match(/^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml))(?:;charset=[a-z0-9-]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');
  let decoded = '';
  try {
    decoded = atob(base64);
  } catch {
    return null;
  }
  if (decoded.length > 600 * 1024) return null;
  if (mime === 'image/svg+xml') {
    const snippet = decoded.slice(0, 8000).toLowerCase();
    if (
      snippet.includes('<script')
      || snippet.includes('javascript:')
      || snippet.includes('<foreignobject')
      || snippet.includes('<iframe')
      || snippet.includes('<object')
      || snippet.includes('<embed')
      || /\son\w+\s*=/.test(snippet)
    ) return null;
  }

  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export interface PublicAuthBrandingState {
  brandTitle: string;
  logoSrc: string;
  logoHeight: number;
  titleFontFamily?: string;
  titleFontSize: number;
  titleFontWeight: string;
  titleOffset: number;
}

export function usePublicAuthBranding(enabled = true): PublicAuthBrandingState {
  const [initialBranding] = useState(readCachedBranding);
  const [branding, setBranding] = useState<PublicPlatformBranding | null>(initialBranding);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(() => enabled ? makeLogoObjectUrl(initialBranding?.logoUrl || initialBranding?.loginLogoUrl) : null);
  const logoObjectUrlRef = useRef(logoObjectUrl);

  useEffect(() => {
    if (!enabled) return;
    const next = makeLogoObjectUrl(branding?.logoUrl || branding?.loginLogoUrl);
    if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
    logoObjectUrlRef.current = next;
    setLogoObjectUrl(next);
    return () => {
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
    };
  }, [branding?.loginLogoUrl, branding?.logoUrl, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiClient.get<unknown>('/api/auth/branding', undefined, { credentials: 'include' })
      .then((data) => {
        if (cancelled || !data || typeof data !== 'object') return;
        const normalized = normalizeBranding(data);
        writeCachedBranding(normalized);
        setBranding(normalized);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[];
    for (const link of links) {
      if (!link.dataset.defaultHref) link.dataset.defaultHref = link.href;
      link.href = branding?.faviconUrl || link.dataset.defaultHref || link.href;
    }
  }, [branding?.faviconUrl, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const styleId = 'public-branding-font';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!branding?.titleFontUrl) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `@font-face { font-family: 'PublicBrandingFont'; src: url('${branding.titleFontUrl}') format('woff2'), url('${branding.titleFontUrl}') format('woff'), url('${branding.titleFontUrl}') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }`;
  }, [branding?.titleFontUrl, enabled]);

  const rawTitleOffset = branding?.titleVerticalOffset;
  return {
    brandTitle: typeof branding?.logoTitle === 'string' && branding.logoTitle.trim() ? branding.logoTitle.trim() : 'EnterpriseGlue',
    logoSrc: logoObjectUrl || logoPng,
    logoHeight: Math.round(16 * ((branding?.logoScale ?? 100) / 100)),
    titleFontFamily: branding?.titleFontUrl ? 'PublicBrandingFont' : undefined,
    titleFontSize: Math.max(branding?.titleFontSize ?? 14, 10),
    titleFontWeight: typeof branding?.titleFontWeight === 'string' && branding.titleFontWeight.trim() ? branding.titleFontWeight.trim() : 'var(--font-weight-semibold)',
    titleOffset: typeof rawTitleOffset === 'number' && Number.isFinite(rawTitleOffset) ? Math.max(-20, Math.min(20, rawTitleOffset)) : 0,
  };
}

interface PublicAuthShellProps {
  title: string;
  description?: React.ReactNode;
  homePath?: string;
  panelSize?: 'default' | 'wide';
  appearance?: 'default' | 'process';
  layout?: 'panel' | 'grid';
  children: React.ReactNode | ((branding: PublicAuthBrandingState) => React.ReactNode);
}

export function PublicAuthHeaderBrand({ branding, useLoginBrandDefaults = false }: {
  branding: PublicAuthBrandingState;
  useLoginBrandDefaults?: boolean;
}) {
  return (
    <span className="eg-login-header-brand">
      <img
        src={branding.logoSrc}
        alt=""
        aria-hidden="true"
        className="eg-login-header-logo default-logo"
        style={{ height: `${branding.logoHeight}px` }}
      />
      <span
        className="eg-login-header-title"
        style={{
          fontSize: useLoginBrandDefaults ? 'var(--cds-heading-compact-02-font-size, 1rem)' : `${branding.titleFontSize}px`,
          fontWeight: branding.titleFontWeight,
          fontFamily: branding.titleFontFamily || (useLoginBrandDefaults ? 'var(--font-ibm-plex-sans, inherit)' : 'inherit'),
          transform: branding.titleOffset ? `translateY(${branding.titleOffset}px)` : undefined,
        }}
      >
        {branding.brandTitle}
      </span>
    </span>
  );
}

export default function PublicAuthShell({
  title,
  description,
  homePath = '/',
  panelSize = 'default',
  appearance = 'process',
  layout = 'panel',
  children,
}: PublicAuthShellProps) {
  const workspaceHeader = useWorkspaceHeader();
  const localBranding = usePublicAuthBranding(!workspaceHeader);
  const branding = workspaceHeader?.branding ?? localBranding;
  const headingId = 'public-auth-page-title';
  const mainAttributes = { id: 'public-auth-main', 'aria-labelledby': headingId, tabIndex: -1 };
  const gridLayout = layout === 'grid';
  const heading = <h1 id={headingId} className={gridLayout ? 'eg-login-grid-title' : 'eg-login-title'} tabIndex={-1}>{title}</h1>;
  const content = typeof children === 'function' ? children(branding) : children;
  const illustrated = appearance === 'process';
  const landscape = illustrated && <div className="eg-login-landscape" aria-hidden="true">
    <img src={processLandscape} alt="" />
  </div>;
  // Give the standard login wordmark more presence without replacing custom fonts/sizes.
  const useLoginBrandDefaults = illustrated && !branding.titleFontFamily && branding.titleFontSize === 14;

  useEffect(() => {
    document.title = `${title} | ${branding.brandTitle}`;
  }, [branding.brandTitle, title]);

  const shell = (
    <div className={`eg-login-shell${illustrated ? ' eg-login-shell--process' : ''}`}>
      {!workspaceHeader && <Theme theme="g100">
        <Header className="eg-login-header" aria-label={`${branding.brandTitle} application header`}>
          <SkipToContent href="#public-auth-main">Skip to main content</SkipToContent>
          <HeaderName href={homePath} prefix="">
            <PublicAuthHeaderBrand branding={branding} useLoginBrandDefaults={useLoginBrandDefaults} />
          </HeaderName>
        </Header>
      </Theme>}
      {gridLayout ? <Grid as="main" {...mainAttributes} className="eg-login-grid">
        {landscape}
        <Column sm={4} md={{ start: 2, span: 6 }}
          lg={{ start: illustrated ? 2 : 5, span: illustrated ? 6 : 8 }}
          xlg={{ start: illustrated ? 2 : 6, span: 6 }}>
          <Tile className="eg-login-grid-panel">
            <Stack gap={7}>
              {heading}
              {description && <p className="eg-login-grid-copy">{description}</p>}
              <Stack gap={6}>{content}</Stack>
            </Stack>
          </Tile>
        </Column>
      </Grid> : <main {...mainAttributes} className="eg-login-page">
        {landscape}
        <section className={`eg-login-panel${panelSize === 'wide' ? ' eg-login-panel--wide' : ''}`}>
          {heading}
          {description && <p className="eg-public-auth-description">{description}</p>}
          {content}
        </section>
      </main>}
    </div>
  );
  return illustrated ? <Theme theme="g100">{shell}</Theme> : shell;
}
