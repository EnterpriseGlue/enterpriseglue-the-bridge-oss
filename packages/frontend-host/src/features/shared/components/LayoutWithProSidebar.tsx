import React, { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Header,
  HeaderGlobalBar,
  HeaderGlobalAction,
  HeaderMenuButton,
  HeaderName,
  HeaderNavigation,
  HeaderMenu,
  HeaderMenuItem,
  Theme,
  Modal,
  Button,
  TextInput,
  InlineNotification,
  InlineLoading,
  MultiSelect,
  Tag,
} from '@carbon/react'
import { Close, Logout, Notification, UserAvatar } from '@carbon/icons-react'
import ProSidebar from './ProSidebar'
import { useAuth } from '../../../shared/hooks/useAuth'
import logoPng from '../../../assets/logo.png'
import { useLayoutStore } from '../stores/layoutStore'
import { useFeatureFlag } from '../../../shared/hooks/useFeatureFlag'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { getEnterpriseFrontendPlugin } from '../../../enterprise/loadEnterpriseFrontendPlugin'
import { ExtensionSlot } from '../../../enterprise/ExtensionSlot'
import { isMultiTenantEnabled, getNavItemsBySection, type NavExtension } from '../../../enterprise/extensionRegistry'

interface TenantBranding {
  logoUrl: string | null;
  loginLogoUrl: string | null;
  logoTitle: string | null;
  loginTitleVerticalOffset: number;
  loginTitleColor: string | null;
  logoScale: number;
  titleFontUrl: string | null;
  titleFontWeight: string;
  titleFontSize: number;
  titleVerticalOffset: number;
  menuAccentColor: string | null;
  faviconUrl: string | null;
}

const BRANDING_CACHE_KEY = 'eg.platformBranding.v1'

type EnterpriseNavItem = {
  label: string
  path: string
}

type NotificationItem = {
  id: string
  state: 'success' | 'info' | 'warning' | 'error'
  title: string
  subtitle?: string | null
  createdAt: number
  readAt?: number | null
}

type NotificationFilterItem = { id: 'success' | 'info' | 'warning' | 'error'; label: string }

const NOTIFICATION_FILTER_ITEMS: NotificationFilterItem[] = [
  { id: 'success', label: 'Success' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warning' },
  { id: 'error', label: 'Error' },
]

// Multi-tenant mode is controlled by EE plugin via extension registry
// In OSS: always false. In EE: set via registerFeatureOverride('multiTenant', true)
const isMultiTenant = isMultiTenantEnabled()

function formatRelativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

function normalizeEnterpriseNavItems(raw: unknown): EnterpriseNavItem[] {
  if (!Array.isArray(raw)) return []

  const items: EnterpriseNavItem[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const anyIt = it as any
    const label = typeof anyIt.label === 'string' ? anyIt.label : (typeof anyIt.name === 'string' ? anyIt.name : null)
    const path = typeof anyIt.path === 'string'
      ? anyIt.path
      : (typeof anyIt.to === 'string' ? anyIt.to : (typeof anyIt.href === 'string' ? anyIt.href : null))
    if (!label || !path) continue
    const normalizedPath = String(path).startsWith('/') ? String(path) : `/${String(path)}`
    items.push({ label, path: normalizedPath })
  }
  return items
}

function normalizeBranding(raw: any): TenantBranding {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    logoUrl: typeof r.logoUrl === 'string' ? r.logoUrl : null,
    loginLogoUrl: typeof r.loginLogoUrl === 'string' ? r.loginLogoUrl : null,
    logoTitle: typeof r.logoTitle === 'string' ? r.logoTitle : null,
    loginTitleVerticalOffset: typeof r.loginTitleVerticalOffset === 'number' ? r.loginTitleVerticalOffset : 0,
    loginTitleColor: typeof r.loginTitleColor === 'string' ? r.loginTitleColor : null,
    logoScale: typeof r.logoScale === 'number' ? r.logoScale : 100,
    titleFontUrl: typeof r.titleFontUrl === 'string' ? r.titleFontUrl : null,
    titleFontWeight: typeof r.titleFontWeight === 'string' ? r.titleFontWeight : '600',
    titleFontSize: typeof r.titleFontSize === 'number' ? r.titleFontSize : 14,
    titleVerticalOffset: typeof r.titleVerticalOffset === 'number' ? r.titleVerticalOffset : 0,
    menuAccentColor: typeof r.menuAccentColor === 'string' ? r.menuAccentColor : null,
    faviconUrl: typeof r.faviconUrl === 'string' ? r.faviconUrl : null,
  }
}

function readCachedBranding(): TenantBranding | undefined {
  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY)
    if (!raw) return undefined
    return normalizeBranding(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function writeCachedBranding(branding: TenantBranding): void {
  try {
    window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding))
  } catch {
  }
}

export default function LayoutWithProSidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { logout, user, refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, toggleSidebarCollapsed } = useLayoutStore()

  const [cachedBranding] = useState(() => readCachedBranding())

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileLastName, setProfileLastName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')

  const isNotificationsEnabled = useFeatureFlag('notifications')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationFilters, setNotificationFilters] = useState<NotificationFilterItem[]>([])
  const notificationPanelRef = React.useRef<HTMLDivElement | null>(null)
  const notificationButtonRef = React.useRef<HTMLSpanElement | null>(null)
  const notificationStates = notificationFilters.map((item) => item.id)
  const notificationsQ = useQuery({
    queryKey: ['notifications', notificationStates.join(',')],
    queryFn: () => apiClient.get<{ notifications: NotificationItem[]; unreadCount: number }>(
      '/api/notifications',
      {
        state: notificationStates.length ? notificationStates.join(',') : undefined,
        limit: 50,
      },
      { credentials: 'include' }
    ),
    enabled: isNotificationsEnabled && !!user,
    staleTime: 15000,
  })

  const notificationItems = notificationsQ.data?.notifications || []
  const notificationUnreadCount = notificationsQ.data?.unreadCount || 0

  const markNotificationsReadM = useMutation({
    mutationFn: () => apiClient.patch('/api/notifications/read', {}, { credentials: 'include' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearNotificationsM = useMutation({
    mutationFn: () => apiClient.delete('/api/notifications', { credentials: 'include' }),
    onMutate: async () => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      // Snapshot previous value
      const previous = queryClient.getQueryData(['notifications', notificationStates.join(',')])
      // Optimistically clear notifications
      queryClient.setQueryData(['notifications', notificationStates.join(',')], { notifications: [], unreadCount: 0 })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['notifications', notificationStates.join(',')], context.previous)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearNotificationM = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/notifications/${encodeURIComponent(id)}`, { credentials: 'include' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      const previous = queryClient.getQueryData(['notifications', notificationStates.join(',')]) as { notifications: NotificationItem[]; unreadCount: number } | undefined
      if (previous) {
        const filtered = previous.notifications.filter((n) => n.id !== id)
        queryClient.setQueryData(['notifications', notificationStates.join(',')], { 
          notifications: filtered, 
          unreadCount: Math.max(0, previous.unreadCount - (previous.notifications.find(n => n.id === id && !n.readAt) ? 1 : 0))
        })
      }
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notifications', notificationStates.join(',')], context.previous)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const [enterpriseNavItems, setEnterpriseNavItems] = useState<EnterpriseNavItem[]>([])

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const effectivePathname = tenantSlug ? (pathname.replace(/^\/t\/[^/]+/, '') || '/') : pathname
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  const inMissionControl = effectivePathname.startsWith('/mission-control')
  const canViewAdminMenu = Boolean(user?.capabilities?.canViewAdminMenu)
  const canViewMissionControl = Boolean(user?.capabilities?.canViewMissionControl)
  const canManagePlatformSettings = Boolean(user?.capabilities?.canManagePlatformSettings)

  const [isTenantAdmin, setIsTenantAdmin] = useState(false)
  const [tenantAdminChecked, setTenantAdminChecked] = useState(false)

  // Feature flags for top-level sections
  const isVoyagerEnabled = useFeatureFlag('voyager')
  const isStarbaseEnabled = useFeatureFlag('starbase')
  const isMissionControlEnabled = useFeatureFlag('missionControl')
  const isEnginesEnabled = useFeatureFlag('engines')

  const hideVoyagerForPlatformAdmin = isMultiTenant && canManagePlatformSettings

  const showVoyagerMenu = isVoyagerEnabled && !hideVoyagerForPlatformAdmin
  const showStarbaseMenu = showVoyagerMenu && isStarbaseEnabled
  const showEnginesMenu = showVoyagerMenu && isEnginesEnabled
  const showMissionControlMenu = showVoyagerMenu && isMissionControlEnabled && canViewMissionControl

  useEffect(() => {
    if (!isMultiTenant || canManagePlatformSettings) {
      setIsTenantAdmin(false)
      setTenantAdminChecked(true)
      return
    }
    if (!tenantSlug) {
      setIsTenantAdmin(false)
      setTenantAdminChecked(true)
      return
    }

    let cancelled = false
    const loadTenantRole = async () => {
      try {
        const data = await apiClient.get<any[]>('/api/auth/my-tenants')
        const m = Array.isArray(data)
          ? data.find((t: any) => String(t?.tenantSlug || '') === String(tenantSlug))
          : undefined
        const ok = Boolean(m?.isTenantAdmin)
        if (!cancelled) setIsTenantAdmin(ok)
      } catch {
        if (!cancelled) setIsTenantAdmin(false)
      }
    }

    setTenantAdminChecked(false)
    loadTenantRole().finally(() => {
      if (!cancelled) setTenantAdminChecked(true)
    })

    return () => {
      cancelled = true
    }
  }, [tenantSlug, canManagePlatformSettings])

  useEffect(() => {
    if (!isProfileModalOpen) return
    setProfileFirstName(user?.firstName || '')
    setProfileLastName(user?.lastName || '')
    setProfileError('')
    setProfileSaving(false)
  }, [isProfileModalOpen, user])

  useEffect(() => {
    if (!notificationsOpen || !notificationUnreadCount) return
    markNotificationsReadM.mutate()
  }, [notificationsOpen, notificationUnreadCount, markNotificationsReadM])

  useEffect(() => {
    if (!notificationsOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (notificationPanelRef.current?.contains(target)) return
      if (notificationButtonRef.current?.contains(target)) return
      setNotificationsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [notificationsOpen])

  const profileHasChanges =
    profileFirstName !== (user?.firstName || '') ||
    profileLastName !== (user?.lastName || '')

  const handleOpenProfile = () => {
    setIsProfileModalOpen(true)
  }

  const handleToggleNotifications = () => {
    if (!isNotificationsEnabled) return
    setNotificationsOpen((prev) => !prev)
  }

  const handleCloseNotifications = () => {
    setNotificationsOpen(false)
  }

  const handleCloseProfile = () => {
    setIsProfileModalOpen(false)
    setProfileError('')
  }

  const handleSaveProfile = async () => {
    try {
      setProfileSaving(true)
      setProfileError('')

      await apiClient.patch('/api/auth/me', {
        firstName: profileFirstName,
        lastName: profileLastName,
      })

      if (refreshUser) {
        await refreshUser()
      }

      setIsProfileModalOpen(false)
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to update profile')
      setProfileError(parsed.message)
    } finally {
      setProfileSaving(false)
    }
  }

  // Fetch tenant branding
  const brandingQuery = useQuery({
    queryKey: ['tenant-branding'],
    queryFn: async (): Promise<TenantBranding> => {
      try {
        const data = await apiClient.get<TenantBranding>('/api/auth/branding', undefined, {
          credentials: 'include',
        })
        const normalized = normalizeBranding(data)
        writeCachedBranding(normalized)
        return normalized
      } catch {
        const cached = readCachedBranding()
        if (cached) return cached
        return {
          logoUrl: null,
          loginLogoUrl: null,
          logoTitle: null,
          loginTitleVerticalOffset: 0,
          loginTitleColor: null,
          logoScale: 100,
          titleFontUrl: null,
          titleFontWeight: '600',
          titleFontSize: 14,
          titleVerticalOffset: 0,
          menuAccentColor: null,
          faviconUrl: null,
        }
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    initialData: cachedBranding,
    initialDataUpdatedAt: cachedBranding ? 0 : undefined,
  })

  const customLogoUrl = brandingQuery.data?.logoUrl
  const customLogoTitle = brandingQuery.data?.logoTitle
  const logoScale = brandingQuery.data?.logoScale ?? 100
  const scaledLogoHeight = Math.round(16 * (logoScale / 100))
  const safeCustomLogoSrc = (() => {
    if (typeof customLogoUrl !== 'string') return null
    const raw = customLogoUrl.trim()
    if (!raw) return null
    if (raw.startsWith('//')) return null

    if (raw.startsWith('data:')) {
      const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
      if (!match) return null
      const mime = match[1].toLowerCase()
      const base64 = match[2].replace(/\s+/g, '')

      const allowedMimes = new Set([
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/gif',
        'image/svg+xml',
      ])
      if (!allowedMimes.has(mime)) return null

      if (mime === 'image/svg+xml') {
        try {
          const decoded = atob(base64)
          const snippet = decoded.slice(0, 5000).toLowerCase()
          if (
            snippet.includes('<script') ||
            snippet.includes('onload=') ||
            snippet.includes('javascript:') ||
            snippet.includes('<foreignobject')
          ) {
            return null
          }
        } catch {
          return null
        }
      }

      return raw
    }

    try {
      const u = new URL(raw, window.location.origin)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u.toString()
    } catch {
      return null
    }
  })()
  const titleFontUrl = brandingQuery.data?.titleFontUrl
  const titleFontWeight = brandingQuery.data?.titleFontWeight ?? '600'
  const titleFontSize = brandingQuery.data?.titleFontSize ?? 14
  const titleVerticalOffset = brandingQuery.data?.titleVerticalOffset ?? 0
  const brandingLoading = brandingQuery.isLoading && !brandingQuery.data
  
  // Generate unique font family name for custom font
  const customFontFamily = titleFontUrl ? 'CustomBrandingFont' : undefined
  const menuAccentColor = brandingQuery.data?.menuAccentColor
  const faviconUrl = brandingQuery.data?.faviconUrl

  // Apply favicon override
  useEffect(() => {
    const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[]
    if (links.length === 0) return

    // Store defaults once
    for (const link of links) {
      if (!link.dataset.defaultHref) {
        link.dataset.defaultHref = link.href
      }
    }

    if (faviconUrl) {
      for (const link of links) {
        link.href = faviconUrl
      }
    } else {
      for (const link of links) {
        if (link.dataset.defaultHref) link.href = link.dataset.defaultHref
      }
    }
  }, [faviconUrl])
  
  // Inject custom font CSS when titleFontUrl changes
  useEffect(() => {
    if (!titleFontUrl) return
    
    const styleId = 'custom-branding-font'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null
    
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }
    
    styleEl.textContent = `
      @font-face {
        font-family: 'CustomBrandingFont';
        src: url('${titleFontUrl}') format('woff2'), url('${titleFontUrl}') format('woff'), url('${titleFontUrl}') format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `
    
    return () => {
      // Cleanup on unmount or when font changes
    }
  }, [titleFontUrl])
  
  // Inject custom menu accent color CSS
  useEffect(() => {
    const styleId = 'custom-menu-accent-color'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null
    
    if (!menuAccentColor) {
      // Remove custom style if no accent color set
      if (styleEl) styleEl.remove()
      return
    }
    
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }
    
    styleEl.textContent = `
      /* Override Carbon CSS custom property at header level */
      .cds--header,
      .cds--header__menu {
        --cds-border-interactive: ${menuAccentColor};
      }
      /* Main menu horizontal underline */
      .cds--header__menu-bar > li > a::after,
      .cds--header__submenu::after {
        background-color: ${menuAccentColor} !important;
      }
    `
    
    return () => {
      // Cleanup on unmount
    }
  }, [menuAccentColor])
  
  const handleLogout = async () => {
    try {
      await logout()
      navigate(toTenantPath('/login'))
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }
  
  React.useEffect(() => {
    if (!sidebarOpen) return
    if (inMissionControl) return
    const onKey = (e: KeyboardEvent) => { 
      if (e.key === 'Escape') {
        // Only collapse if expanded, don't expand if already collapsed
        if (!sidebarCollapsed) {
          setSidebarCollapsed(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen, sidebarCollapsed, setSidebarCollapsed, inMissionControl])

  React.useEffect(() => {
    if (!inMissionControl) return
    if (sidebarCollapsed) setSidebarCollapsed(false)
  }, [inMissionControl, sidebarCollapsed, setSidebarCollapsed])

  useEffect(() => {
    let cancelled = false

    getEnterpriseFrontendPlugin()
      .then((plugin) => {
        if (cancelled) return
        setEnterpriseNavItems(normalizeEnterpriseNavItems((plugin as any)?.navItems))
      })
      .catch(() => {
        if (cancelled) return
        setEnterpriseNavItems([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Theme theme="g100" style={{ height: '100vh', width: '100%', overflow: 'hidden' }}>
      <Modal
        open={isProfileModalOpen}
        modalHeading="My Profile"
        primaryButtonText={profileSaving ? 'Saving...' : 'Save Changes'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={profileSaving || !profileHasChanges}
        onRequestClose={handleCloseProfile}
        onRequestSubmit={handleSaveProfile}
      >
        {profileError && (
          <InlineNotification
            kind="error"
            title="Error"
            subtitle={profileError}
            onCloseButtonClick={() => setProfileError('')}
            style={{ marginBottom: 'var(--spacing-5)' }}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Email</div>
            <div style={{ fontSize: '14px' }}>{user?.email || ''}</div>
          </div>

          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Role</div>
            <Tag type={user?.capabilities?.canAccessAdminRoutes ? 'purple' : 'gray'} size="sm">
              {user?.capabilities?.canAccessAdminRoutes ? 'Platform Admin' : 'User'}
            </Tag>
          </div>

          <TextInput
            id="profile-first-name"
            labelText="First Name"
            value={profileFirstName}
            onChange={(e) => setProfileFirstName(e.target.value)}
          />

          <TextInput
            id="profile-last-name"
            labelText="Last Name"
            value={profileLastName}
            onChange={(e) => setProfileLastName(e.target.value)}
          />

          {/* Git Connections moved to Project → (⋯) → Git Settings */}
        </div>
      </Modal>
      {/* Entire app shell uses g100 dark theme - header menus inherit this */}
      <Header aria-label="Voyager">
              {!inMissionControl && (
                <HeaderMenuButton
                  aria-label="Toggle sidebar"
                  onClick={toggleSidebarCollapsed}
                  isActive={!sidebarCollapsed}
                />
              )}
              <HeaderName href={toTenantPath('/')} prefix="">
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  {safeCustomLogoSrc ? (
                    <img
                      src={safeCustomLogoSrc}
                      alt={customLogoTitle || 'Logo'}
                      style={{ height: `${scaledLogoHeight}px`, width: 'auto', objectFit: 'contain' }}
                    />
                  ) : (
                    <img
                      src={logoPng}
                      alt="EnterpriseGlue Logo"
                      className="default-logo"
                      style={{ height: `${scaledLogoHeight}px`, width: 'auto', visibility: brandingLoading ? 'hidden' : 'visible' }}
                    />
                  )}
                  {(customLogoTitle || (!safeCustomLogoSrc && !brandingLoading)) && (
                    <span style={{ 
                      fontFamily: customFontFamily ? `'${customFontFamily}', sans-serif` : 'inherit',
                      fontSize: `${titleFontSize}px`, 
                      fontWeight: titleFontWeight,
                      lineHeight: '20px',
                      position: 'relative',
                      top: `${titleVerticalOffset}px`,
                    }}>
                      {customLogoTitle || 'EnterpriseGlue'}
                    </span>
                  )}
                </span>
              </HeaderName>
              {/* TenantPicker is an extension slot - empty in OSS, filled by EE plugin */}
              <ExtensionSlot name="tenant-picker" />
              <HeaderNavigation aria-label="Main navigation">
                {showVoyagerMenu && (
                  <HeaderMenu menuLinkName="Voyager">
                    {showStarbaseMenu && (
                      <HeaderMenuItem
                        href={toTenantPath('/starbase')}
                        isCurrentPage={effectivePathname.startsWith('/starbase')}
                        onClick={(e) => { e.preventDefault(); navigate(toTenantPath('/starbase')); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        Starbase
                      </HeaderMenuItem>
                    )}
                    {showMissionControlMenu && (
                      <HeaderMenuItem
                        href={toTenantPath('/mission-control/processes')}
                        isCurrentPage={effectivePathname.startsWith('/mission-control')}
                        onClick={(e) => { e.preventDefault(); navigate(toTenantPath('/mission-control/processes')); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        Mission Control
                      </HeaderMenuItem>
                    )}
                    {showEnginesMenu && (
                      <HeaderMenuItem
                        href={toTenantPath('/engines')}
                        isCurrentPage={effectivePathname.startsWith('/engines')}
                        onClick={(e) => { e.preventDefault(); navigate(toTenantPath('/engines')); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        Engines
                      </HeaderMenuItem>
                    )}
                  </HeaderMenu>
                )}
                {enterpriseNavItems.length > 0 && (
                  <HeaderMenu menuLinkName="Enterprise">
                    {enterpriseNavItems.map((item) => (
                      <HeaderMenuItem
                        key={`${item.path}:${item.label}`}
                        href={toTenantPath(item.path)}
                        isCurrentPage={effectivePathname === item.path || effectivePathname.startsWith(`${item.path}/`)}
                        onClick={(e) => { e.preventDefault(); navigate(toTenantPath(item.path)); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        {item.label}
                      </HeaderMenuItem>
                    ))}
                  </HeaderMenu>
                )}
                {!isMultiTenant && canViewAdminMenu && (
                  <HeaderMenu menuLinkName="Admin">
                    <HeaderMenuItem
                      href={toTenantPath('/admin/users')}
                      isCurrentPage={effectivePathname === '/admin/users'}
                      onClick={(e) => { e.preventDefault(); navigate(toTenantPath('/admin/users')); (document.activeElement as HTMLElement)?.blur() }}
                    >
                      User Management
                    </HeaderMenuItem>
                    <HeaderMenuItem
                      href={toTenantPath('/admin/settings')}
                      isCurrentPage={effectivePathname === '/admin/settings'}
                      onClick={(e) => { e.preventDefault(); navigate(toTenantPath('/admin/settings')); (document.activeElement as HTMLElement)?.blur() }}
                    >
                      Platform Settings
                    </HeaderMenuItem>
                  </HeaderMenu>
                )}
                {/* Tenant Admin menu - only shows if EE plugin registers tenant-admin nav items */}
                {isMultiTenant && !canViewAdminMenu && tenantAdminChecked && isTenantAdmin && getNavItemsBySection('tenant-admin').length > 0 && (
                  <HeaderMenu menuLinkName="Admin">
                    {getNavItemsBySection('tenant-admin').map((item: NavExtension) => (
                      <HeaderMenuItem
                        key={item.id}
                        href={toTenantPath(item.path)}
                        isCurrentPage={effectivePathname === item.path || effectivePathname.startsWith(`${item.path}/`)}
                        onClick={(e) => { e.preventDefault(); navigate(toTenantPath(item.path)); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        {item.label}
                      </HeaderMenuItem>
                    ))}
                  </HeaderMenu>
                )}
                {isMultiTenant && canViewAdminMenu && (
                  <HeaderMenu menuLinkName="Admin">
                    {/* EE-only admin nav items (e.g., Tenants) - rendered from extension registry */}
                    {getNavItemsBySection('admin').map((item: NavExtension) => (
                      <HeaderMenuItem
                        key={item.id}
                        href={item.path}
                        isCurrentPage={effectivePathname === item.path || effectivePathname.startsWith(`${item.path}/`)}
                        onClick={(e) => { e.preventDefault(); navigate(item.path); (document.activeElement as HTMLElement)?.blur() }}
                      >
                        {item.label}
                      </HeaderMenuItem>
                    ))}
                  </HeaderMenu>
                )}
              </HeaderNavigation>
              <HeaderGlobalBar>
                <HeaderGlobalAction
                  aria-label="Notifications"
                  tooltipAlignment="center"
                  onClick={handleToggleNotifications}
                >
                  <span ref={notificationButtonRef} style={{ position: 'relative', display: 'inline-flex' }}>
                    <Notification size={20} />
                    {notificationUnreadCount > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -2,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: 'var(--cds-support-error)',
                        }}
                      />
                    )}
                  </span>
                </HeaderGlobalAction>
                <HeaderGlobalAction aria-label="User" tooltipAlignment="end" onClick={handleOpenProfile}>
                  <UserAvatar size={20} />
                </HeaderGlobalAction>
                <HeaderGlobalAction 
                  aria-label="Logout" 
                  tooltipAlignment="end"
                  onClick={handleLogout}
                >
                  <Logout size={20} />
                </HeaderGlobalAction>
              </HeaderGlobalBar>
              {notificationsOpen && (
                <div
                  ref={notificationPanelRef}
                  style={{
                    position: 'fixed',
                    top: 48,
                    right: 'var(--spacing-5)',
                    width: 360,
                    maxHeight: 'calc(100vh - 96px)',
                    background: 'var(--cds-layer-01)',
                    border: '1px solid var(--color-border-primary)',
                    borderRadius: 'var(--border-radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 'var(--z-popover)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--spacing-4)',
                      borderBottom: '1px solid var(--color-border-primary)',
                      background: 'var(--cds-layer-02)',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>Notifications</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                      <Button
                        kind="ghost"
                        size="sm"
                        disabled={clearNotificationsM.isPending || notificationItems.length === 0}
                        onClick={() => clearNotificationsM.mutate()}
                      >
                        Clear all
                      </Button>
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={Close}
                        iconDescription="Close notifications"
                        onClick={handleCloseNotifications}
                      />
                    </div>
                  </div>
                  <div style={{ padding: 'var(--spacing-4)', borderBottom: '1px solid var(--color-border-primary)' }}>
                    <MultiSelect
                      id="notification-filters"
                      titleText="Filter"
                      label="Filter"
                      items={NOTIFICATION_FILTER_ITEMS}
                      itemToString={(item: NotificationFilterItem | null) => item?.label || ''}
                      selectedItems={notificationFilters}
                      onChange={({ selectedItems }) => {
                        setNotificationFilters((selectedItems as NotificationFilterItem[]) || [])
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                    {notificationsQ.isLoading && (
                      <InlineLoading description="Loading notifications" />
                    )}
                    {notificationsQ.isError && (
                      <InlineNotification
                        kind="error"
                        title="Failed to load notifications"
                        subtitle={parseApiError(notificationsQ.error, 'Failed to load').message}
                        lowContrast
                      />
                    )}
                    {!notificationsQ.isLoading && !notificationsQ.isError && notificationItems.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No notifications yet.</div>
                    )}
                    {notificationItems.map((item) => {
                      const subtitle = (() => {
                        if (!item.subtitle) return null
                        if (typeof item.subtitle === 'string') {
                          const trimmed = item.subtitle.trim()
                          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                            try {
                              const parsed = JSON.parse(trimmed)
                              const message = parsed?.error?.message || parsed?.message || parsed?.error
                              if (typeof message === 'string' && message.trim()) return message
                            } catch {
                              // ignore JSON parsing errors
                            }
                          }
                          return item.subtitle
                        }
                        const message = (item.subtitle as any)?.error?.message
                          || (item.subtitle as any)?.message
                          || (item.subtitle as any)?.error
                        if (typeof message === 'string' && message.trim()) return message
                        return String(item.subtitle)
                      })()
                      const createdAtMs = typeof item.createdAt === 'number'
                        ? item.createdAt
                        : Number(item.createdAt)
                      const createdAtLabel = Number.isFinite(createdAtMs)
                        ? formatRelativeTime(createdAtMs)
                        : 'Just now'
                      const isUnread = !item.readAt

                      return (
                        <div
                          key={item.id}
                          style={{
                            opacity: isUnread ? 1 : 0.7,
                            position: 'relative',
                          }}
                        >
                          {isUnread && (
                            <span
                              style={{
                                position: 'absolute',
                                top: 12,
                                left: 6,
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: 'var(--cds-link-primary, #0f62fe)',
                                zIndex: 1,
                              }}
                            />
                          )}
                          <InlineNotification
                            kind={item.state}
                            title={item.title}
                            lowContrast
                            hideCloseButton={false}
                            onClose={() => { clearNotificationM.mutate(item.id); return false }}
                            style={{ maxWidth: '100%', marginBottom: 0 }}
                          >
                            {subtitle && <span style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>{subtitle}</span>}
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--cds-text-helper)' }}>{createdAtLabel}</span>
                          </InlineNotification>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
        </Header>
      
      {/* Main content area below fixed header */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'row', 
        height: 'calc(100vh - 48px)',
        marginTop: '48px',
        width: '100%',
        overflow: 'hidden',
      }}>
        {/* Sidebar - inherits g100 from root */}
        <ProSidebar />
        
        {/* Page content - g10 light theme for pages */}
        <Theme theme="g10" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <main style={{ 
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            backgroundColor: 'var(--cds-background)',
          }}>
            <Outlet />
          </main>
        </Theme>
      </div>
    </Theme>
  )
}
