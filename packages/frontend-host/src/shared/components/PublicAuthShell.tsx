import React, { useEffect, useRef, useState } from 'react';
import { Header, HeaderName, SkipToContent, Theme } from '@carbon/react';
import type { PublicPlatformBranding } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { apiClient } from '../api/client';
import logoPng from '../../assets/logo.png';

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

function usePublicAuthBranding(): PublicAuthBrandingState {
  const [initialBranding] = useState(readCachedBranding);
  const [branding, setBranding] = useState<PublicPlatformBranding | null>(initialBranding);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(() => makeLogoObjectUrl(initialBranding?.logoUrl || initialBranding?.loginLogoUrl));
  const logoObjectUrlRef = useRef(logoObjectUrl);

  useEffect(() => {
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
  }, [branding?.loginLogoUrl, branding?.logoUrl]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[];
    for (const link of links) {
      if (!link.dataset.defaultHref) link.dataset.defaultHref = link.href;
      link.href = branding?.faviconUrl || link.dataset.defaultHref || link.href;
    }
  }, [branding?.faviconUrl]);

  useEffect(() => {
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
  }, [branding?.titleFontUrl]);

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
  children: React.ReactNode | ((branding: PublicAuthBrandingState) => React.ReactNode);
}

export default function PublicAuthShell({
  title,
  description,
  homePath = '/',
  panelSize = 'default',
  children,
}: PublicAuthShellProps) {
  const branding = usePublicAuthBranding();
  const headingId = 'public-auth-page-title';

  useEffect(() => {
    document.title = `${title} | ${branding.brandTitle}`;
  }, [branding.brandTitle, title]);

  return (
    <div className="eg-login-shell">
      <Theme theme="g100">
        <Header aria-label={`${branding.brandTitle} application header`}>
          <SkipToContent href="#public-auth-main">Skip to main content</SkipToContent>
          <HeaderName href={homePath} prefix="">
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
                  fontSize: `${branding.titleFontSize}px`,
                  fontWeight: branding.titleFontWeight,
                  fontFamily: branding.titleFontFamily || 'inherit',
                  transform: branding.titleOffset ? `translateY(${branding.titleOffset}px)` : undefined,
                }}
              >
                {branding.brandTitle}
              </span>
            </span>
          </HeaderName>
        </Header>
      </Theme>
      <main id="public-auth-main" className="eg-login-page" aria-labelledby={headingId} tabIndex={-1}>
        <section className={`eg-login-panel${panelSize === 'wide' ? ' eg-login-panel--wide' : ''}`}>
          <h1 id={headingId} className="eg-login-title">{title}</h1>
          {description && <p className="eg-public-auth-description">{description}</p>}
          {typeof children === 'function' ? children(branding) : children}
        </section>
      </main>
    </div>
  );
}
